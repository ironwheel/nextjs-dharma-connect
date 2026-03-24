"""
Email sending functionality for email-agent.
Provides functions for sending emails with template processing and variable substitution.
"""

import smtplib
import re
import time
import sys
import os
import hmac
import html as html_escape
from decimal import Decimal, InvalidOperation
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.headerregistry import Address
from typing import Dict, List, Optional
import boto3
from botocore.exceptions import ClientError

from .config import (
    SMTP_SERVER, SMTP_PORT, DEFAULT_PREVIEW, DEFAULT_FROM_NAME,
    EMAIL_ACCOUNT_CREDENTIALS_TABLE, AWS_REGION, REGLINKV2_HASHGEN_SECRET
)
from .prompts import prompt_lookup
from .eligible import check_eligibility
from .steps.shared import code_to_full_language

# Cache for email account credentials to avoid repeated DynamoDB calls
_credentials_cache = {}


def _retreat_net_offering_dollars(wrc_row: Dict) -> float:
    """Net amount due for a retreat (matches register: offeringTotal - offeringCashTotal)."""
    if not wrc_row:
        return 0.0
    try:
        tot = float(wrc_row.get('offeringTotal') or 0)
        cash = float(wrc_row.get('offeringCashTotal') or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, tot - cash)


def _sum_installment_payments_received(installments: Dict) -> float:
    """Sum installment line offeringAmount; skip refunded aggregate key."""
    received = 0.0
    for k, row in installments.items():
        if k == 'refunded' or not isinstance(row, dict):
            continue
        try:
            received += float(row.get('offeringAmount') or 0)
        except (TypeError, ValueError):
            continue
    return received


def _generate_auth_hash(guid: str, secret_key_hex: str) -> str:
    """
    Generate an HMAC-SHA256 hash of a UUID using a secret key (same algorithm as API authUtils).
    """
    if not re.match(r'^[0-9a-f]{64}$', secret_key_hex, re.IGNORECASE):
        raise ValueError('Secret key must be a 64-character hexadecimal string')
    key_bytes = bytes.fromhex(secret_key_hex)
    return hmac.new(key_bytes, guid.encode('utf-8'), 'sha256').hexdigest()


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
               dryrun: bool = False, transaction_data: Dict = None) -> bool:
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

    # Transaction Receipt adjustments
    if transaction_data:
        warning_event_code = (
            transaction_data.get('eventCode')
            or transaction_data.get('event_code')
            or event.get('aid')
            or 'unknown'
        )
        event_image_url = (event.get('config') or {}).get('eventImage')
        if event_image_url:
            try:
                def img_replacer(match):
                    tag = match.group(0)
                    # Mailchimp often includes the hero/banner as an <img> with a data-file-id
                    # but may not include the internal "mcnImage" marker, depending on export/source.
                    should_replace = (
                        'mcnImage' in tag
                        or ('data-file-id' in tag and 'mcusercontent.com/' in tag)
                        # Deterministic targeting for custom receipt templates.
                        or ('data-event-image="true"' in tag or "data-event-image='true'" in tag)
                    )
                    if should_replace:
                        return re.sub(r'src="[^"]+"', f'src="{event_image_url}"', tag)
                    return tag
                
                html = re.sub(r'<img[^>]+>', img_replacer, html)
            except Exception as e:
                print(f"Warning: Failed to replace event image for transaction receipt: {e}")
        else:
            print(
                f"Warning: No eventImage configured for transaction receipt eventCode '{warning_event_code}'"
            )

        if "#receipt" in html:
            try:
                skus = transaction_data.get('skuSummary', [])
                currency = transaction_data.get('currency', 'USD')
                total_cents = Decimal('0')

                full_language = code_to_full_language(language)
                title_text = html_escape.escape(
                    prompt_lookup(prompts_array, 'title', full_language, event['aid']) or ''
                )

                # Spare / meadow-style receipt block: table rows (no textarea).
                font = (
                    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
                    "Arial,sans-serif"
                )
                line_rows: List[str] = []
                for sku in skus:
                    raw_amount_cents = sku.get('amountCents', 0)
                    try:
                        amount_cents = Decimal(str(raw_amount_cents))
                    except (InvalidOperation, TypeError):
                        amount_cents = Decimal('0')
                    amount = amount_cents / Decimal('100')
                    total_cents += amount_cents
                    currency_str = sku.get('currency', currency).upper()
                    amt_display = f"${float(amount):.2f} {currency_str}"
                    if sku.get('subEvent') == 'kmFee':
                        desc = "Kalapa Media 5% Fee"
                    else:
                        person_name = html_escape.escape(str(sku.get('personName', '') or ''))
                        offering_sku = html_escape.escape(str(sku.get('offeringSKU', '') or ''))
                        desc = f"{person_name}, {offering_sku}"
                    line_rows.append(
                        '<tr>'
                        f'<td style="padding:6px 0;font-size:14px;line-height:20px;color:#374151;">{desc}</td>'
                        f'<td style="padding:6px 0;font-size:14px;line-height:20px;color:#111827;'
                        f'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">'
                        f'{amt_display}</td>'
                        '</tr>'
                    )

                total_display = f"${float(total_cents / Decimal('100')):.2f} {currency.upper()}"
                receipt_html = (
                    f'<div style="text-align:left;font-family:{font};">'
                    f'<div style="font-style:italic;font-size:14px;line-height:20px;color:#0f766e;'
                    f'margin-bottom:12px;">{title_text}</div>'
                    f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                    f'width="100%" style="border-collapse:collapse;">'
                    f'{"".join(line_rows)}'
                    '<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding:0;height:1px;">'
                    '</td></tr>'
                    '<tr>'
                    '<td style="padding:10px 0 0 0;font-size:14px;line-height:20px;font-weight:700;'
                    'color:#111827;">Total</td>'
                    f'<td style="padding:10px 0 0 0;font-size:14px;line-height:20px;font-weight:700;'
                    f'color:#111827;text-align:right;white-space:nowrap;'
                    f'font-variant-numeric:tabular-nums;">{total_display}</td>'
                    '</tr>'
                    '</table>'
                    '</div>'
                )

                html = html.replace("#receipt", receipt_html)
            except Exception as e:
                print(f"Warning: Failed to construct #receipt: {e}")
        
        if "#paymentid" in html:
            html = html.replace("#paymentid", transaction_data.get('paymentIntentId', ''))

        if "||cardbrand||" in html or "||cardlast4||" in html:
            card = transaction_data.get('card') or {}
            brand_raw = card.get('brand') or card.get('Brand') or ''
            last4_raw = card.get('last4') or card.get('Last4') or ''
            html = html.replace("||cardbrand||", html_escape.escape(str(brand_raw)))
            html = html.replace("||cardlast4||", html_escape.escape(str(last4_raw)))

    # If #salutation directive in html, replace it with the langauge specific salutation
    # replacing the ||name|| field in the prompts with the person's name
    if "#salutation" in html:
        full_language = code_to_full_language(language)
        salutation_text = prompt_lookup(prompts_array, 'salutation', full_language, event['aid'])
        if not salutation_text:
            raise Exception(f"Can't use #salutation. No prompt found for prompt: salutation, {full_language}")
        # name will get replaced with the person's name below
        html = html.replace("#salutation", salutation_text)

    # If ||title|| directive in html, replace it with the localized title prompt
    # Uses event['aid'] for correct title resolution in both normal and transactionReceipt modes.
    if "||title||" in html:
        full_language = code_to_full_language(language)
        title_text = prompt_lookup(prompts_array, 'title', full_language, event['aid'])
        html = html.replace("||title||", title_text)

    # If #reglink directive in html, replace it with the langauge specific reg link language
    # ||pid|| will get replaced with the participant's pid below
    # ||name|| will get replaced with the person's name below
    # ||aid|| will get replaced with the event's aid below
    if "#reglink" in html:
        full_language = code_to_full_language(language)
        reglinkv2 = (event.get('config') or {}).get('reglinkv2')
        prompt_key = 'reglinkv2' if reglinkv2 else 'reglink'
        registration_link_text = prompt_lookup(prompts_array, prompt_key, full_language, event['aid'])
        if not registration_link_text:
            raise Exception(f"Can't use #reglink. No prompt found for prompt: {prompt_key}, {full_language}")
        html = html.replace("#reglink", registration_link_text)

    # If #tangralink directive in html, replace it with the langauge specific reg link language
    # ||pid|| will get replaced with the participant's pid below
    # ||name|| will get replaced with the person's name below
    # ||taid|| will get replaced with the event's tangra link aid below
    if "#tangralink" in html:
        tangra = (event.get('config') or {}).get('tangra')
        if tangra is None or (isinstance(tangra, str) and not tangra.strip()):
            raise Exception("Can't use #tangralink. No tangra field found in the event config.")
        full_language = code_to_full_language(language)
        tangra_link_text = prompt_lookup(prompts_array, 'tangralink', full_language, event['aid'])
        if not tangra_link_text:
            raise Exception(f"Can't use #tangralink. No prompt found for prompt: tangralink, {full_language}")
        html = html.replace("#tangralink", tangra_link_text)

    # If #offeringsection <subevent> directive in html, replace it with the langauge specific offering section language
    # placeholder pid will get replaced with the participant's pid below
    # ||pid|| will get replaced with the participant's pid below
    # ||name|| will get replaced with the person's name below
    # ||aid|| will get replaced with the event's aid below
    if "#offeringsection" in html:
        subevent = html.split("#offeringsection")[1].split(" ")[0]
        full_language = code_to_full_language(language)
        offering_section_text = prompt_lookup(prompts_array, 'offeringsection', full_language, event['aid'])
        if not offering_section_text:
            raise Exception(f"Can't use #offeringsection. No prompt found for prompt: offeringsection, {full_language}")
        # Add the subevent to the offering section #if offering <subevent>
        offering_section_text = offering_section_text.replace("<subevent>", subevent)
        # remove the subevent from the original html
        html = html.replace(f"{subevent}", "")
        # Replace the #offeringsection directive with the offering section text
        html = html.replace("#offeringsection", offering_section_text)

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
                # Convert language code to full language name for prompt_lookup
                full_language = code_to_full_language(language)
                prompt_text = prompt_lookup(prompts_array, which_retreats_config[key]['prompt'], full_language, event['aid'])
                if not prompt_text:
                    raise Exception(f"Can't use ||retreats||. No prompt found for: {which_retreats_config[key]['prompt']}, {full_language}")
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
                total += _retreat_net_offering_dollars(which_retreats_config[key])
        
        received = 0.0
        try:
            some = student['programs'][event['aid']]['offeringHistory']['retreat']['installments']
        except:
            some = False
        
        if some and isinstance(some, dict):
            received = _sum_installment_payments_received(some)
        
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

    # Replace placeholder pid with student ID
    html = html.replace("123456789", student.get('id', ''))
    html = html.replace("||pid||", student.get('id', ''))

    # Replace ||hash|| with HMAC-SHA256(pid, secret) using REGLINKV2_HASHGEN_SECRET (same algo as API authUtils)
    if "||hash||" in html:
        if not REGLINKV2_HASHGEN_SECRET:
            raise Exception("Can't use ||hash||. REGLINKV2_HASHGEN_SECRET environment variable not set.")
        pid = student.get('id', '')
        auth_hash = _generate_auth_hash(pid, REGLINKV2_HASHGEN_SECRET)
        html = html.replace("||hash||", auth_hash)

    # Replace placeholder aid with event aid
    html = html.replace("||aid||", event['aid'])

    # Replace placeholder taid with event tangra link aid (only when ||taid|| is used)
    if "||taid||" in html:
        tangra = (event.get('config') or {}).get('tangra')
        if tangra is None or (isinstance(tangra, str) and not tangra.strip()):
            raise Exception("Can't use ||taid||. No tangra field found in the event config.")
        html = html.replace("||taid||", str(tangra).strip())

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
                    condition = check_eligibility('oath', student, event['aid'], pools_array, event.get('subevent'))
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
                            total_received = _sum_installment_payments_received(oh)

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
                                        total_required += _retreat_net_offering_dollars(which_retreats_config[key])
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