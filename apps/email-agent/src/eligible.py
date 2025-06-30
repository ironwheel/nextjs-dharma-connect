"""
@file apps/email-agent/src/eligible.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility function to check student eligibility based on pool definitions.
"""

from typing import Dict, List, Any, Optional


def check_eligibility(pool_name: str, student_data: Dict[str, Any], current_aid: str, all_pools_data: List[Dict[str, Any]], current_subevent: str = None) -> bool:
    """
    Checks if a student is eligible for content based on pool definitions.
    Recursive function to handle nested pool logic.

    Args:
        pool_name: The name of the eligibility pool to check.
        student_data: The student data object containing programs, practice info, etc.
        current_aid: The AID of the current event context, for program-specific checks.
        all_pools_data: The complete array of pool definition objects. Should be an array.
        current_subevent: The current subevent for program-specific checks.

    Returns:
        True if the student is eligible according to the specified pool, false otherwise.
    """
    if not isinstance(all_pools_data, list):
        print(f"Eligibility check error: Expected all_pools_data to be a list, but received: {type(all_pools_data)} {all_pools_data}")
        return False

    pool = next((p for p in all_pools_data if p.get('name') == pool_name), None)
    if not pool:
        print(f"Eligibility check failed: Pool definition not found for name: {pool_name} in context AID: {current_aid}")
        return False

    if not pool.get('attributes') or len(pool['attributes']) == 0:
        print(f"Eligibility check warning: Pool has no attributes defined: {pool_name}")
        return False

    # Check each attribute rule within the pool
    for attr in pool['attributes']:
        is_eligible = False

        attr_type = attr.get('type')
        if attr_type == 'true':
            is_eligible = True
        elif attr_type == 'pool':
            is_eligible = check_eligibility(attr['name'], student_data, current_aid, all_pools_data, current_subevent)
        elif attr_type == 'pooldiff':
            is_eligible = (check_eligibility(attr['inpool'], student_data, current_aid, all_pools_data, current_subevent) and
                          not check_eligibility(attr['outpool'], student_data, current_aid, all_pools_data, current_subevent))
        elif attr_type == 'pooland':
            is_eligible = (check_eligibility(attr['pool1'], student_data, current_aid, all_pools_data, current_subevent) and
                          check_eligibility(attr['pool2'], student_data, current_aid, all_pools_data, current_subevent))
        elif attr_type == 'practice':
            field = attr.get('field')
            is_eligible = bool(student_data.get('practice', {}).get(field))
        elif attr_type == 'offering':
            aid = attr.get('aid')
            subevent = attr.get('subevent')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(subevent, {})
            is_eligible = bool(subevent_data.get('offeringSKU')) and not bool(program.get('withdrawn')) 
        elif attr_type == 'currenteventoffering':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(current_subevent, {})
            is_eligible = bool(subevent_data.get('offeringSKU')) and not bool(program.get('withdrawn'))   
        elif attr_type == 'currenteventtest':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = program.get('test', {})
        elif attr_type == 'notoffering':
            aid = attr.get('aid')
            subevent = attr.get('subevent')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(subevent, {})
            is_eligible = not bool(subevent_data.get('offeringSKU'))
        elif attr_type == 'offeringandpools':
            aid = attr.get('aid')
            subevent = attr.get('subevent')
            pools = attr.get('pools', [])
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            offering_history = program.get('offeringHistory', {})
            if subevent in offering_history:
                is_eligible = any(check_eligibility(p, student_data, current_aid, all_pools_data, current_subevent) for p in pools)
        elif attr_type == 'oath':
            aid = attr.get('aid')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            is_eligible = bool(program.get('oath'))
        elif attr_type == 'attended':
            aid = attr.get('aid')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            is_eligible = bool(program.get('attended'))
        elif attr_type == 'join':
            aid = attr.get('aid')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            is_eligible = bool(program.get('join'))   
        elif attr_type == 'currenteventjoin':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('join'))   
        elif attr_type == 'currenteventaccepted':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('accepted')) and not bool(program.get('withdrawn')) 
        elif attr_type == 'notjoin':
            aid = attr.get('aid')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            is_eligible = not bool(program.get('join'))
        elif attr_type == 'joinwhich':
            aid = attr.get('aid')
            retreat = attr.get('retreat')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            if (program.get('join') and 
                not program.get('withdrawn') and 
                program.get('whichRetreats')):
                keys = list(program['whichRetreats'].keys())
                is_eligible = any(key.startswith(retreat) for key in keys)
        elif attr_type == 'eligible':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('eligible'))
        else:
            print(f"UNKNOWN POOL ATTRIBUTE TYPE encountered: {pool_name} {attr_type}")
            is_eligible = False

        if is_eligible:
            return True

    return False 