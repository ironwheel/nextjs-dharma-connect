"""
Prompt utilities for email-agent.
Provides functions for looking up and formatting localized prompt strings.
"""

from typing import List, Dict, Optional


def prompt_lookup(prompts_array: List[Dict], prompt_key: str, language: str, aid: str) -> str:
    """
    Looks up a prompt string based on its key, language, and application ID (aid).
    It first checks for an AID-specific prompt, then a default prompt.
    
    Args:
        prompts_array: The array of prompt objects. Each object should have 'prompt' (string, e.g., "aid-key"), 
                      'language' (string), and 'text' (string) properties.
        prompt_key: The key of the prompt to look up (without the 'aid-' or 'default-' prefix).
        language: The desired language for the prompt (e.g., "English", "Spanish").
        aid: The application/area ID for context-specific prompts (e.g., "dashboard", "specificFeature").
    
    Returns:
        The localized prompt text, or an "unknown" placeholder string if not found.
    """
    if not prompts_array or len(prompts_array) == 0:
        return f"{aid}-{prompt_key}-{language}-promptsUndefined"

    full_aid_prompt_key = f"{aid}-{prompt_key}"
    default_prompt_key = f"default-{prompt_key}"

    # AID-specific prompt
    for p in prompts_array:
        if p.get('prompt') == full_aid_prompt_key and p.get('language') == language:
            return p.get('text', '')

    # Default prompt (language-specific or universal)
    for p in prompts_array:
        if p.get('prompt') == default_prompt_key and (p.get('language') == language or p.get('language') == 'universal'):
            return p.get('text', '')

    return f"{aid}-{prompt_key}-{language}-unknown" 