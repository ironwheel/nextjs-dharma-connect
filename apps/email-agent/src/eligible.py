"""
@file apps/email-agent/src/eligible.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility function to check student eligibility based on pool definitions.
"""

from typing import Dict, List, Any, Optional


def _iter_installment_amounts_raw(installments: Any) -> float:
    """Sum offeringAmount on installment lines; skips aggregate 'refunded' key (matches register)."""
    if not installments or not isinstance(installments, dict):
        return 0.0
    total = 0.0
    for key, entry in installments.items():
        if key == 'refunded':
            continue
        if not isinstance(entry, dict):
            continue
        amt = entry.get('offeringAmount')
        try:
            n = float(amt)
            if n == n and n != float('inf'):
                total += n
        except (TypeError, ValueError):
            pass
    return total


def apply_installments_limit_fee_selected(
    selected: List[str],
    program: Dict[str, Any],
    cfg: Dict[str, Any],
) -> List[str]:
    """
    When installments + limitFee + config.offeringLimitFeeCount apply, only the first N selected
    retreats (list order preserved from whichRetreats iteration) contribute to thresholds.
    """
    if not selected:
        return selected
    if not program.get('limitFee'):
        return selected
    raw = cfg.get('offeringLimitFeeCount')
    if raw is None:
        return selected
    if isinstance(raw, bool):
        return selected
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return selected
    if n < 1 or n >= len(selected):
        return selected
    return selected[:n]


def _installments_paid_cents(offering_history: Any, history_uses_cents: bool) -> int:
    """
    Total installment payments across all subevents in offeringHistory, in cents.
    When reglinkv2 is false, per-line amounts are treated as dollars and converted to cents.
    """
    if not offering_history or not isinstance(offering_history, dict):
        return 0
    raw = 0.0
    for sub_entry in offering_history.values():
        if isinstance(sub_entry, dict):
            raw += _iter_installment_amounts_raw(sub_entry.get('installments'))
    if history_uses_cents:
        return int(raw)
    return int(round(raw * 100))


def _currentevent_installments_paid_lt_threshold(
    program: Dict[str, Any],
    event_context: Optional[Dict[str, Any]],
    mode: str,
) -> bool:
    """
    For config.offeringPresentation == 'installments': true when total installment payments (cents)
    are strictly less than the configured threshold for the student's selected retreats.

    - mode 'minimum': paid cents < sum(offeringMinimum) in cents
    - mode 'balance': paid cents < sum(max(0, offeringTotal - offeringCashTotal)) in cents

    Excludes withdrawn students. Requires event_context (full event record) for config.
    """
    if not event_context or not isinstance(program, dict):
        return False
    if program.get('withdrawn'):
        return False
    cfg = event_context.get('config') or {}
    if str(cfg.get('offeringPresentation') or '').lower() != 'installments':
        return False
    which_config = cfg.get('whichRetreatsConfig')
    if not isinstance(which_config, dict):
        return False
    wr = program.get('whichRetreats')
    if not wr or not isinstance(wr, dict):
        return False
    selected = [k for k, v in wr.items() if v is True]
    if not selected:
        return False
    selected = apply_installments_limit_fee_selected(selected, program, cfg)
    min_cents = 0
    bal_cents = 0
    for key in selected:
        rc = which_config.get(key)
        if not isinstance(rc, dict):
            return False
        try:
            om = float(rc.get('offeringMinimum') or 0)
            min_cents += max(0, int(round(om * 100)))
        except (TypeError, ValueError):
            return False
        try:
            tot = float(rc.get('offeringTotal') or 0)
            cash = float(rc.get('offeringCashTotal') or 0)
            bal_cents += max(0, int(round((tot - cash) * 100)))
        except (TypeError, ValueError):
            return False
    paid_cents = _installments_paid_cents(program.get('offeringHistory'), bool(cfg.get('reglinkv2')))
    if mode == 'minimum':
        return paid_cents < min_cents
    if mode == 'balance':
        return paid_cents < bal_cents
    return False


def _sum_installment_payments_cents(installments: Any) -> int:
    """Sum offeringAmount for all installment lines (keys ignored; legacy deposit/balance included)."""
    if not installments or not isinstance(installments, dict):
        return 0
    total = 0
    for entry in installments.values():
        if not isinstance(entry, dict):
            continue
        amt = entry.get('offeringAmount')
        try:
            n = float(amt)
            if n == n and n != float('inf'):
                total += int(n)
        except (TypeError, ValueError):
            pass
    return total


def subevent_has_offering_activity(sub_entry: Any) -> bool:
    """True if classic offeringSKU exists or any installment payments recorded."""
    if not sub_entry or not isinstance(sub_entry, dict):
        return False
    sku = sub_entry.get('offeringSKU')
    if sku is not None and str(sku).strip() != '':
        return True
    inst = sub_entry.get('installments')
    return _sum_installment_payments_cents(inst) > 0


def check_eligibility(
    pool_name: str,
    student_data: Dict[str, Any],
    current_aid: str,
    all_pools_data: List[Dict[str, Any]],
    current_subevent: str = None,
    event_context: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Checks if a student is eligible for content based on pool definitions.
    Recursive function to handle nested pool logic.

    Args:
        pool_name: The name of the eligibility pool to check.
        student_data: The student data object containing programs, practice info, etc.
        current_aid: The AID of the current event context, for program-specific checks.
        all_pools_data: The complete array of pool definition objects. Should be an array.
        current_subevent: The current subevent for program-specific checks.
        event_context: Optional full event record (e.g. from get_event) for attributes that read config.

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
            # Validate that 'name' field exists
            if 'name' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'pool' type attribute missing required 'name' field. Attribute data: {attr}")
            is_eligible = check_eligibility(attr['name'], student_data, current_aid, all_pools_data, current_subevent, event_context)
        elif attr_type == 'pooldiff':
            # Validate required fields
            if 'inpool' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'pooldiff' type attribute missing required 'inpool' field. Attribute data: {attr}")
            if 'outpool' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'pooldiff' type attribute missing required 'outpool' field. Attribute data: {attr}")
            is_eligible = (check_eligibility(attr['inpool'], student_data, current_aid, all_pools_data, current_subevent, event_context) and
                          not check_eligibility(attr['outpool'], student_data, current_aid, all_pools_data, current_subevent, event_context))
        elif attr_type == 'pooland':
            # Validate required fields
            if 'pool1' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'pooland' type attribute missing required 'pool1' field. Attribute data: {attr}")
            if 'pool2' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'pooland' type attribute missing required 'pool2' field. Attribute data: {attr}")
            is_eligible = (check_eligibility(attr['pool1'], student_data, current_aid, all_pools_data, current_subevent, event_context) and
                          check_eligibility(attr['pool2'], student_data, current_aid, all_pools_data, current_subevent, event_context))
        elif attr_type == 'practice':
            field = attr.get('field')
            is_eligible = bool(student_data.get('practice', {}).get(field))
        elif attr_type == 'offering':
            aid = attr.get('aid')
            subevent = attr.get('subevent')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            offering_history = program.get('offeringHistory', {})
            if subevent == 'any':
                # Check if student has any offering in any subevent for this program
                is_eligible = False
                for subevent_key in offering_history.keys():
                    subevent_data = offering_history.get(subevent_key, {})
                    if subevent_has_offering_activity(subevent_data):
                        is_eligible = True
                        break
                is_eligible = is_eligible and not bool(program.get('withdrawn'))
            else:
                # Check specific subevent (classic SKU or installments)
                subevent_data = offering_history.get(subevent, {})
                is_eligible = subevent_has_offering_activity(subevent_data) and not bool(program.get('withdrawn'))
        elif attr_type == 'currenteventoffering':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(current_subevent, {})
            is_eligible = subevent_has_offering_activity(subevent_data) and not bool(program.get('withdrawn'))
        elif attr_type == 'currenteventtest':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = program.get('test', {})
        elif attr_type == 'currenteventnotoffering':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(current_subevent, {})
            is_eligible = not subevent_has_offering_activity(subevent_data)
        elif attr_type == 'currenteventminimumdue':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = _currentevent_installments_paid_lt_threshold(program, event_context, 'minimum')
        elif attr_type == 'currenteventbalancedue':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = _currentevent_installments_paid_lt_threshold(program, event_context, 'balance')
        elif attr_type == 'offeringandpools':
            # Validate required fields
            if 'aid' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'offeringandpools' type attribute missing required 'aid' field. Attribute data: {attr}")
            if 'subevent' not in attr:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'offeringandpools' type attribute missing required 'subevent' field. Attribute data: {attr}")
            aid = attr.get('aid')
            subevent = attr.get('subevent')
            pools = attr.get('pools', [])
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            offering_history = program.get('offeringHistory', {})
            if subevent_has_offering_activity(offering_history.get(subevent)):
                is_eligible = any(check_eligibility(p, student_data, current_aid, all_pools_data, current_subevent, event_context) for p in pools)
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
        elif attr_type == 'currenteventmanualinclude':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('manualInclude'))
        elif attr_type == 'currenteventaccepted':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('accepted')) and not bool(program.get('withdrawn')) 
        elif attr_type == 'currenteventnotjoin':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = not bool(program.get('join'))
        elif attr_type == 'joinwhich':
            aid = attr.get('aid')
            retreat = attr.get('retreat')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            if (program.get('join') and 
                not program.get('withdrawn') and 
                program.get('whichRetreats')):
                which_retreats = program['whichRetreats']
                keys = list(which_retreats.keys())
                is_eligible = any(key.startswith(retreat) and which_retreats[key] for key in keys)
        elif attr_type == 'offeringwhich':
            aid = attr.get('aid')
            retreat = attr.get('retreat')
            subevent = attr.get('subevent')
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            if (program.get('join') and 
                not program.get('withdrawn') and 
                program.get('whichRetreats')):
                # First check: verify the retreat is in whichRetreats and is truthy
                which_retreats = program['whichRetreats']
                retreat_keys = list(which_retreats.keys())
                has_retreat = any(key.startswith(retreat) and which_retreats[key] for key in retreat_keys)
                
                # Second check: verify offering exists for the subevent (independent of whichRetreats)
                if has_retreat and program.get('offeringHistory'):
                    offering_history = program['offeringHistory']
                    offering_keys = list(offering_history.keys())
                    is_eligible = any(
                        key.startswith(subevent) and subevent_has_offering_activity(offering_history[key])
                        for key in offering_keys
                    )
        elif attr_type == 'eligible':
            programs = student_data.get('programs', {})
            program = programs.get(current_aid, {})
            is_eligible = bool(program.get('eligible'))
        elif attr_type == 'specifiedAIDBool':
            aid = attr.get('aid')
            bool_name = attr.get('boolName')
            if aid is None:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'specifiedAIDBool' type attribute missing required 'aid' field. Attribute data: {attr}")
            if bool_name is None:
                raise ValueError(f"Pool '{pool_name}' has a malformed 'specifiedAIDBool' type attribute missing required 'boolName' field. Attribute data: {attr}")
            programs = student_data.get('programs', {})
            program = programs.get(aid, {})
            is_eligible = bool(program.get(bool_name))
        else:
            print(f"UNKNOWN POOL ATTRIBUTE TYPE encountered: {pool_name} {attr_type}")
            is_eligible = False

        if is_eligible:
            return True

    return False 