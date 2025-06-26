"""
Shared functions for email agent steps
"""

LANG_CODE_TO_NAME = {
    "EN": "English",
    "FR": "French", 
    "ES": "Spanish",
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