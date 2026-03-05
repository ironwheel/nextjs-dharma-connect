import { ScriptContext, StepConditionConfig } from './types';

function getValueAtPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Substitute {{eventCode}} in a field path with context.event.aid.
 */
function resolveFieldPath(field: string, context: ScriptContext): string {
    const eventCode = context.event?.aid ?? '';
    return field.replace(/\{\{eventCode\}\}/g, eventCode);
}

/**
 * Evaluate a parameterized step condition against current context.
 * Returns true when the step should be shown.
 */
export function evaluateStepCondition(config: StepConditionConfig, context: ScriptContext): boolean {
    const path = resolveFieldPath(config.field, context);
    const value = getValueAtPath(context.student, path);

    switch (config.type) {
        case 'fieldEquals':
            return value === config.value;

        case 'fieldOneOf': {
            if (!value || typeof value !== 'object') return false;
            return config.keys.some((k) => value[k]);
        }

        case 'fieldExactlyOneOf': {
            if (!value || typeof value !== 'object') return false;
            const count = config.keys.filter((k) => value[k]).length;
            return count === 1;
        }

        case 'fieldNoneOf': {
            if (!value || typeof value !== 'object') return true;
            return !config.keys.some((k) => value[k]);
        }

        default:
            return true;
    }
}
