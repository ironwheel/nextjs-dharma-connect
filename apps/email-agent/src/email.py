"""
Email sending functionality for email-agent.
Provides functions for sending emails with template processing and variable substitution.
"""

import smtplib
import re
import time
import sys
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.headerregistry import Address
from typing import Dict, List, Optional
import boto3
from botocore.exceptions import ClientError

from .config import (
    SMTP_SERVER, SMTP_PORT, DEFAULT_PREVIEW, DEFAULT_FROM_NAME,
    EMAIL_ACCOUNT_CREDENTIALS_TABLE, AWS_REGION
)
from .prompts import prompt_lookup
from .eligible import check_eligibility

# Cache for email account credentials to avoid repeated DynamoDB calls
_credentials_cache = {}

def lookup_email_account_credentials(account: str, country: str) -> tuple[str, str]:
    """
    Look up email account credentials from DynamoDB with caching.
    
    Args:
        account: The account name to look up
        country: The country for account conversion logic
        
    Returns:
        Tuple of (smtp_username, smtp_password)
        
    Raises:
        Exception: If account is not found
    """
    # Create cache key from account and country
    cache_key = f"{account}:{country}"
    
    # Check cache first
    if cache_key in _credentials_cache:
        return _credentials_cache[cache_key]
    
    # Account conversion logic for foundations and gmb
    if account in ['foundations', 'gmb']:
        if country in ["United States", "Canada", "Mexico", "Chile", "Brazil", "Columbia"]:
            account = account + '-americas'
        else:
            account = account + '-europe'
    
    # Read from DynamoDB
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(EMAIL_ACCOUNT_CREDENTIALS_TABLE)
    
    try:
        response = table.get_item(Key={'account': account})
        if 'Item' not in response:
            raise Exception(f"email credential lookup can't find account {account}")
        
        data = response['Item']
        credentials = (data['smtp_username'], data['smtp_password'])
        
        # Cache the result
        _credentials_cache[cache_key] = credentials
        
        return credentials
    except ClientError as e:
        raise Exception(f"email credential lookup can't find account {account}: {str(e)}")


def send_email(html: str, subject: str, language: str, account: str, student: Dict, 
               event: Dict, pools_array: List[Dict], prompts_array: List[Dict], 
               dryrun: bool = False) -> bool:
    """
    Send an email with template processing and variable substitution.
    
    Args:
        html: String containing the html email file to be sent
        subject: String containing the subject of the email to be sent
        language: String containing the full string language (not the two letter code)
        account: String containing the email account to use to send the email
        student: Full student record from WORK_ORDERS_TABLE
        event: Full event structure from EVENTS_TABLE
        pools_array: Array of all pools from the POOL_TABLE
        prompts_array: Array of all prompts from the PROMPTS_TABLE
        dryrun: Boolean that when true indicates that send_email() should go through all of the steps 
                of preparing to send, but not actually send the email.
    
    Returns:
        True if successful, False otherwise
        
    Raises:
        Exception: If any error occurs during processing
    """
    # Get SMTP credentials using student's country
    student_country = student.get('country', 'United States')  # Default to US if not specified
    smtp_username, smtp_password = lookup_email_account_credentials(account, student_country)
    
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    
    # Get student email
    email_to = student.get('email')
    if not email_to:
        raise Exception("Student email not found")
    msg['To'] = email_to

    # Replace any ||name|| fields with the person's name
    html = html.replace("||name||", f"{student.get('first', '')} {student.get('last', '')}")

    # Replace ||retreats|| with the contents of the whichRetreats field for this aid
    if "||retreats||" in html:
        try:
            which_retreats_config = event['config']['whichRetreatsConfig']
        except:
            raise Exception("Can't use ||retreats||. No whichRetreatsConfig object found for event.")
        
        retreats_html = "<ul>"
        keys = list(student['programs'][event['aid']]['whichRetreats'].keys())
        keys.sort()
        at_least_one = False
        
        for key in keys:
            if student['programs'][event['aid']]['whichRetreats'][key]:
                prompt_text = prompt_lookup(prompts_array, which_retreats_config[key]['prompt'], language, event['aid'])
                if not prompt_text:
                    raise Exception(f"Can't use ||retreats||. No prompt found for: {which_retreats_config[key]['prompt']}, {language}")
                at_least_one = True
                retreats_html += f'<li><b>{prompt_text}</b></li>'
        
        retreats_html += "</ul>"
        if not at_least_one:
            raise Exception(f"||retreats|| failed at least one rule: {student.get('first')}, {student.get('last')}, {student.get('id')}")
        html = html.replace("||retreats||", retreats_html)

    # Replace ||balance|| with the balance due, only supports installments
    if "||balance||" in html:
        try:
            which_retreats_config = event['config']['whichRetreatsConfig']
        except:
            raise Exception("Can't use ||balance|| in a non-multiple retreats event.")
        
        total = 0
        keys = list(student['programs'][event['aid']]['whichRetreats'].keys())
        for key in keys:
            if student['programs'][event['aid']]['whichRetreats'][key]:
                total += which_retreats_config[key]['offeringTotal']
        
        received = 0
        try:
            some = student['programs'][event['aid']]['offeringHistory']['retreat']['installments']
        except:
            some = False
        
        if some:
            keys = list(some.keys())
            for key in keys:
                received += some[key]['offeringAmount']
        
        try:
            currency = event['config']['currency']
        except:
            currency = 'USD'
        
        if currency != 'EUR':
            currency_symbol = '$'
            currency_abbrev = 'USD'
        else:
            currency_symbol = '€'
            currency_abbrev = 'EUR'
        
        balance = f"{currency_symbol}{total - received} {currency_abbrev}"
        html = html.replace("||balance||", balance)

    # Swap out the title and preview
    preview = DEFAULT_PREVIEW.replace('"', '')
    html = html.replace("*|MC_PREVIEW_TEXT|*", preview)
    html = html.replace("*|MC:SUBJECT|*", preview)
        
    # Get rid of the comments
    html = re.sub("(<!--.*?-->)", "", html, flags=re.DOTALL)

    # Add magic metadata if it doesn't already exist
    if not html.count('<meta http-equiv="Content-Type" content="text/html charset=UTF-8" />'):
        html = html.replace('<meta charset="UTF-8">', '<meta http-equiv="Content-Type" content="text/html charset=UTF-8" />')

    # Use provided credentials
    coord_email = smtp_username
        
    coord_email_href = f'<u><a href="mailto:{coord_email}" target="_blank" style="mso-line-height-rule: exactly;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%;color: #FFFFFF;font-weight: normal;text-decoration: underline;"><span style="color:#0000FF">{coord_email}</span></a></u>'
    html = html.replace("||coord-email||", coord_email_href)

    msg['From'] = f"{DEFAULT_FROM_NAME}<{coord_email}>"

    # Replace placeholder with student ID
    html = html.replace("123456789", student.get('id', ''))

    # Filter the HTML via any #if/#else/#endif statements
    in_if = False
    filtered_html = ''
    for line in html.splitlines():
        if not in_if:
            # Look for an #if statement and change state, throwing out the line
            if '#if' in line:
                in_if = True
                index = line.index('#if')
                largs = re.split("[ <]", line[index+4:])
                if largs[0] == 'oathed':
                    condition = check_eligibility('oath', student, event['aid'], pools_array)
                elif largs[0] == 'offering':
                    try:
                        installments = event['config']['offeringPresentation'] == 'installments'
                    except:
                        installments = False
                    
                    if installments:
                        try:
                            oh = student['programs'][event['aid']]['offeringHistory']['retreat']['installments']
                        except:
                            oh = False

                        if not oh:
                            condition = False
                        else:
                            total_received = 0
                            for key in oh.keys():
                                total_received += oh[key]['offeringAmount']

                            try:
                                wr = student['programs'][event['aid']]['whichRetreats']
                            except:
                                wr = False

                            if not wr:
                                print(f"NO WR: {student.get('first')}, {student.get('last')}, {student.get('id')}")
                                condition = False
                            else:
                                try:
                                    limit_fee = student['programs'][event['aid']]['limitFee']
                                except:
                                    limit_fee = False

                                key_count = 0
                                for key in wr.keys():
                                    if wr[key]:
                                        key_count += 1

                                if limit_fee and key_count > 2:
                                    key_count = 2

                                try:
                                    which_retreats_config = event['config']['whichRetreatsConfig']
                                except:
                                    raise Exception("Can't use #if offering with installments in a non-multiple retreats event.")

                                total_required = 0
                                keys = list(student['programs'][event['aid']]['whichRetreats'].keys())
                                count = 0
                                for key in keys:
                                    if student['programs'][event['aid']]['whichRetreats'][key]:
                                        total_required += which_retreats_config[key]['offeringTotal']
                                        count += 1
                                        if count >= key_count:
                                            break

                                condition = total_required <= total_received
                    else:
                        try:
                            condition = student['programs'][event['aid']]['offeringHistory'][largs[1]]
                        except:
                            condition = False
                elif largs[0] == 'retreats':
                    try:
                        condition = any((key.startswith(largs[1]) and student['programs'][event['aid']]['whichRetreats'][key]) for key in student['programs'][event['aid']]['whichRetreats'])
                    except:
                        condition = False
                    if not condition:
                        try:
                            condition = any((key.startswith(largs[2]) and student['programs'][event['aid']]['whichRetreats'][key]) for key in student['programs'][event['aid']]['whichRetreats'])
                        except:
                            condition = False
                else:
                    raise Exception(f"Unknown #if condition: {largs[0]}")

                # Eat line
                continue
            elif '#endif' in line:
                raise Exception("Non-prefaced #endif")
            elif '#else' in line:
                raise Exception("Non-prefaced #else")
            else:
                # Pass it
                if len(filtered_html) != 0:
                    filtered_html += '\n'
                filtered_html += line
        else:
            # Currently inIf
            # Check for #else and #endif
            if '#endif' in line:
                in_if = False
                continue
            elif '#else' in line:
                condition = not condition
                continue
            else:
                if condition:
                    # Pass it
                    if len(filtered_html) != 0:
                        filtered_html += '\n'
                    filtered_html += line
    
    if in_if:
        raise Exception("EOF in #if condition")

    html = filtered_html
            
    if dryrun:
        try:
            written_lang = student.get('writtenLangPref', 'English')
        except:
            written_lang = 'English'
        print(f"DRYRUN: {student.get('email')}, {student.get('country')}, {smtp_username}, {coord_email}, {written_lang}")
        return True
    
    part1 = MIMEText(preview, 'plain')
    part2 = MIMEText(html, 'html')

    msg.attach(part1)
    msg.attach(part2)

    attempts = 0
    while attempts < 5:
        try:
            mail = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
            mail.starttls()
            mail.login(smtp_username, smtp_password)
            mail.sendmail(coord_email, email_to, msg.as_string())
            mail.quit()
            return True
        except smtplib.SMTPResponseException as e:
            error_code = e.smtp_code
            error_message = e.smtp_error
            if error_code == 421:
                print("Waiting for a minute...")
                time.sleep(60)
                print("Trying again...")
                attempts += 1
                continue
            else:
                raise Exception(f"mail.sendmail() FAILS: {error_code}, {error_message}")
        except Exception as e:
            raise Exception(f"mail.sendmail() FAILS: {sys.exc_info()[0]}")
    
    return False 