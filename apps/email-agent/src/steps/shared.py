"""
Shared functions for email agent steps
"""

from ..eligible import check_eligibility

LANG_CODE_TO_NAME = {
    "EN": "English",
    "FR": "French", 
    "SP": "Spanish",
    "DE": "German",
    "IT": "Italian",
    "CZ": "Czech",
    "PT": "Portuguese"
}

LANG_NAME_TO_CODE = {v: k for k, v in LANG_CODE_TO_NAME.items()}

def code_to_full_language(code):
    """Convert language code to full language name"""
    return LANG_CODE_TO_NAME.get(code.upper(), code)

def passes_stage_filter(stage_record, eligible):
    """
    Check if the stage passes the pool filter.
    
    Args:
        stage_record: The stage record from DynamoDB containing pools field
        eligible: The eligible object with check_eligibility method
        
    Returns:
        bool: True if stage passes filter, False otherwise
    """
    # If no pools field exists, always pass
    if not stage_record or 'pools' not in stage_record:
        return True
    
    # Check each pool in the pools list
    pools = stage_record.get('pools', [])
    for pool in pools:
        if not eligible.check_eligibility(pool):
            return False
    
    return True

def build_campaign_string(event_code, sub_event, stage, language):
    """
    Build a standardized campaign string for email tracking.
    
    Args:
        event_code: The event code
        sub_event: The sub event name
        stage: The stage name
        language: The language code
        
    Returns:
        str: The campaign string
    """
    return f"{event_code}-{sub_event}-{stage}-{language}"

def get_stage_prefix(stage_record, language):
    """
    Get the prefix for a stage and language from the stage record.
    
    Args:
        stage_record: The stage record from DynamoDB containing prefix field
        language: The language code
        
    Returns:
        str: The prefix for the language, or empty string if not found
    """
    if not stage_record or 'prefix' not in stage_record:
        return ""
    
    prefixes = stage_record.get('prefix', {})
    return prefixes.get(language, "")

def find_eligible_students(student_data, pools_data, work_order, campaign_string, stage_record, lang, create_eligible_object_func):
    """
    Find eligible students using consistent logic across all steps.
    
    Args:
        student_data: List of student records
        pools_data: List of pool definitions
        work_order: The work order being processed
        campaign_string: The campaign string for this language
        stage_record: The stage record from DynamoDB
        lang: The language code being processed
        create_eligible_object_func: Function to create eligible object for stage filtering
        
    Returns:
        List[Dict]: List of eligible student records
    """
    eligible_students = []
    lang_full_name = code_to_full_language(lang).lower()
    
    for student in student_data:
        # Skip if unsubscribe is true
        if student.get('unsubscribe', False):
            continue
        
        # Check if already received the email
        emails = student.get('emails', {})
        has_received = campaign_string in emails
        if has_received:
            continue
        
        # Language eligibility check
        if lang_full_name == 'english':
            # If the language is English, all eligible students get the email
            pass
        else:
            # If the language is not English, only students with matching writtenLangPref get the email
            written_lang = student.get('writtenLangPref')
            if not written_lang or written_lang.lower() != lang_full_name:
                continue
        
        # Apply all filters
        pool_name = work_order.config.get('pool') if hasattr(work_order, 'config') and work_order.config else None
        if not pool_name:
            continue
            
        is_eligible = check_eligibility(
            pool_name, student, work_order.eventCode, pools_data, work_order.subEvent
        )
        
        if not is_eligible:
            continue
        
        # Apply stage-specific filtering using shared function
        if passes_stage_filter(stage_record, create_eligible_object_func(student, work_order.eventCode, pools_data, work_order.subEvent)):
            eligible_students.append(student)
    
    return eligible_students 