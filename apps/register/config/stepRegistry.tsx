import React from 'react';
import { ScriptStep, StepConditionConfig, ScriptContext } from '../components/script/types';
import { promptLookup } from '../components/script/StepComponents';
import {
    RenderIntroduction,
    RenderWrittenTranslation,
    RenderJoin,
    RenderMotivation,
    RenderOath,
    RenderLocation,
    RenderWhichRetreats,
    RenderPreferenceNecessity,
    RenderVyOnlineSeries,
    RenderMobilePhone,
    RenderInPersonTeachings,
    RenderInterestedInSetup,
    RenderInterestedInTakedown,
    RenderHealthcareProfessional,
    RenderServiceAlready,
    RenderServiceNoQuestion,
    RenderServiceContact,
    RenderAccessibility,
    RenderSupplicationMY,
    RenderSupplicationVY,
    RenderJoinMY,
    RenderJoinVY,
    RenderVisibleSignature,
    RenderSocialMedia,
    RenderSave,
} from '../components/script/StepComponents';

// Registry mapping step keys to their definition template.
// Use showWhen to show a step only when a previous answer matches (e.g. fieldEquals for yes/no,
// fieldExactlyOneOf for "exactly one of these options selected"). Field paths can use {{eventCode}}.
export const stepRegistry: Record<string, ScriptStep> = {
    'introduction': {
        id: 'introduction',
        type: 'custom',
        component: RenderIntroduction as any,
        field: null as any
    },
    'writtenTranslation': {
        id: 'writtenTranslation',
        type: 'custom',
        component: RenderWrittenTranslation as any,
        field: 'student.writtenLangPref',
        promptKey: 'writtenTranslation'
    },
    'location': {
        id: 'location',
        type: 'custom',
        component: RenderLocation as any,
        field: 'student',
        promptKey: 'location'
    },
    'whichRetreats': {
        id: 'whichRetreats',
        type: 'custom',
        component: RenderWhichRetreats as any,
        field: 'student.programs',
        promptKey: 'whichRetreats',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const whichRetreats = value?.[eventCode]?.whichRetreats;
            if (!whichRetreats || typeof whichRetreats !== 'object') return promptLookup(context, 'whichRetreatsRequired');
            const hasAny = Object.values(whichRetreats).some(Boolean);
            return hasAny ? null : promptLookup(context, 'whichRetreatsRequired');
        }
    },
    'preferenceNecessity': {
        id: 'preferenceNecessity',
        type: 'custom',
        component: RenderPreferenceNecessity as any,
        field: 'student.programs',
        promptKey: 'prefNec',
        showWhen: {
            type: 'fieldExactlyOneOf',
            field: 'programs.{{eventCode}}.whichRetreats',
            keys: ['vajrayana1', 'vajrayana2']
        },
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const prefNec = value?.[eventCode]?.prefNec;
            if (!prefNec || typeof prefNec !== 'object') return promptLookup(context, 'prefNecRequired');
            const hasOne = Object.values(prefNec).some(Boolean);
            return hasOne ? null : promptLookup(context, 'prefNecRequired');
        }
    },
    'vyOnlineSeries': {
        id: 'vyOnlineSeries',
        type: 'custom',
        component: RenderVyOnlineSeries as any,
        field: 'student.programs',
        promptKey: 'vyOnlineSeries',
        showWhen: {
            type: 'fieldOneOf',
            field: 'programs.{{eventCode}}.whichRetreats',
            keys: ['vajrayana1', 'vajrayana2']
        },
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const vyOnlineSeries = value?.[eventCode]?.vyOnlineSeries;
            if (typeof vyOnlineSeries !== 'boolean') return promptLookup(context, 'yesNoRequired');
            return null;
        }
    },
    'mobilePhone': {
        id: 'mobilePhone',
        type: 'custom',
        component: RenderMobilePhone as any,
        field: 'student.mobilePhone',
        promptKey: 'mobilePhone',
        validation: (value: any, context: ScriptContext): string | null => {
            const s = typeof value === 'string' ? value?.trim() : value;
            return s ? null : promptLookup(context, 'mobilePhoneRequired');
        }
    },
    'inPersonTeachings': {
        id: 'inPersonTeachings',
        type: 'custom',
        component: RenderInPersonTeachings as any,
        field: 'student.inPersonTeachings',
        promptKey: 'inPersonTeachings',
        validation: (value: any, context: ScriptContext): string | null => {
            if (typeof value !== 'boolean') return promptLookup(context, 'yesNoRequired');
            return null;
        }
    },
    'interestedInSetup': {
        id: 'interestedInSetup',
        type: 'custom',
        component: RenderInterestedInSetup as any,
        field: 'student.programs',
        promptKey: 'setup',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const setup = value?.[eventCode]?.setup;
            if (!setup || typeof setup !== 'object') return promptLookup(context, 'setupRequired');
            const cfg = context.config?.setupConfig as Record<string, { radioGroups?: string[] }> | undefined;
            let exclusiveKey: string | null = null;
            const multiKeys: string[] = [];
            if (cfg) {
                for (const [key, obj] of Object.entries(cfg)) {
                    if (Array.isArray(obj?.radioGroups) && obj.radioGroups.length > 0 && obj.radioGroups.some((k: string) => k !== key)) {
                        exclusiveKey = key;
                        multiKeys.push(...obj.radioGroups);
                        break;
                    }
                }
            }
            const noChecked = exclusiveKey ? !!setup[exclusiveKey] : false;
            const anyMulti = multiKeys.some((k) => setup[k] === true);
            if (noChecked && anyMulti) return promptLookup(context, 'setupRequired');
            if (!noChecked && !anyMulti) return promptLookup(context, 'setupRequired');
            return null;
        }
    },
    'interestedInTakedown': {
        id: 'interestedInTakedown',
        type: 'custom',
        component: RenderInterestedInTakedown as any,
        field: 'student.programs',
        promptKey: 'interestedInTakedown',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const interestedInTakedown = value?.[eventCode]?.interestedInTakedown;
            if (typeof interestedInTakedown !== 'boolean') return promptLookup(context, 'yesNoRequired');
            return null;
        }
    },
    'healthcareProfessional': {
        id: 'healthcareProfessional',
        type: 'custom',
        component: RenderHealthcareProfessional as any,
        field: 'student.healthcareProfessional',
        promptKey: 'healthcareProfessional',
        validation: (value: any, context: ScriptContext): string | null => {
            if (typeof value !== 'boolean') return promptLookup(context, 'yesNoRequired');
            if (value === true) {
                const training = typeof context.student?.healthcareTraining === 'string' ? context.student.healthcareTraining.trim() : '';
                if (!training) return promptLookup(context, 'trainingRequired');
            }
            return null;
        }
    },
    'serviceAlready': {
        id: 'serviceAlready',
        type: 'custom',
        component: RenderServiceAlready as any,
        field: 'student.programs',
        promptKey: 'serviceAlready',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const serviceAlready = value?.[eventCode]?.serviceAlready;
            if (typeof serviceAlready !== 'boolean') return promptLookup(context, 'yesNoRequired');
            if (serviceAlready === true) {
                const role = typeof value?.[eventCode]?.serviceAlreadyResponse === 'string'
                    ? value[eventCode].serviceAlreadyResponse.trim()
                    : '';
                if (!role) return promptLookup(context, 'roleRequired');
            }
            return null;
        }
    },
    'serviceNoQuestion': {
        id: 'serviceNoQuestion',
        type: 'custom',
        component: RenderServiceNoQuestion as any,
        field: 'student.programs',
        promptKey: 'service',
        showWhen: { type: 'fieldEquals', field: 'programs.{{eventCode}}.serviceAlready', value: false },
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const service = value?.[eventCode]?.service;
            if (!service || typeof service !== 'object') return promptLookup(context, 'serviceNoQuestionRequired');
            const happySelected = service.happy === true;
            const otherCount = Object.entries(service).filter(
                ([key, v]) => key !== 'happy' && v === true
            ).length;
            // happy is mutually exclusive; state with happy + others is invalid
            if (happySelected && otherCount > 0) return promptLookup(context, 'serviceNoQuestionRequired');
            // either happy OR at least 3 non-happy options must be selected
            if (!happySelected && otherCount < 3) return promptLookup(context, 'serviceNoQuestionRequired');
            return null;
        }
    },
    'serviceContact': {
        id: 'serviceContact',
        type: 'custom',
        component: RenderServiceContact as any,
        field: 'student.programs',
        promptKey: 'serviceContact',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const contact = value?.[eventCode]?.serviceContact;
            if (!contact || typeof contact !== 'object') return promptLookup(context, 'serviceContactRequired');
            const selected = Object.values(contact).filter((v) => v === true).length;
            return selected === 1 ? null : promptLookup(context, 'serviceContactRequired');
        }
    },
    'accessiblity': {
        id: 'accessiblity',
        type: 'custom',
        component: RenderAccessibility as any,
        field: 'student.accessibility',
        promptKey: 'accessibility',
        validation: (value: any, context: ScriptContext): string | null => {
            if (typeof value !== 'boolean') return promptLookup(context, 'yesNoRequired');
            if (value === true && !context.config?.noAccessibilityDetails) {
                const details = context.student?.accessibilityDetails;
                if (details == null || String(details).trim() === '') {
                    return promptLookup(context, 'accessibilityDetailsRequired');
                }
            }
            return null;
        }
    },
    'supplicationMY': {
        id: 'supplicationMY',
        type: 'custom',
        component: RenderSupplicationMY as any,
        field: null as any,
        promptKey: 'supplicationTitleMY',
        showWhen: {
            type: 'fieldOneOf',
            field: 'programs.{{eventCode}}.whichRetreats',
            keys: ['mahayana']
        },
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const prog = context.student?.programs?.[eventCode] || {};
            const joinVal = prog.joinMY;
            const visible = prog.visible;

            if (joinVal !== true) {
                // Join must be explicitly confirmed "Yes" to proceed, but does NOT use yesNoRequired prompt key.
                return promptLookup(context, 'joinRequired');
            }

            if (typeof visible !== 'boolean') {
                // Only the visibleSignature prompt uses the generic yes/no required message.
                return promptLookup(context, 'yesNoRequired');
            }

            return null;
        }
    },
    'joinMY': {
        id: 'joinMY',
        type: 'custom',
        component: RenderJoinMY as any,
        field: 'student.programs',
        promptKey: 'joinMY',
        // Now rendered as part of the supplicationMY step; hide this standalone step.
        condition: () => false
    },
    'supplicationVY': {
        id: 'supplicationVY',
        type: 'custom',
        component: RenderSupplicationVY as any,
        field: null as any,
        promptKey: 'supplicationTitleVY',
        showWhen: {
            type: 'fieldOneOf',
            field: 'programs.{{eventCode}}.whichRetreats',
            keys: ['vajrayana1', 'vajrayana2']
        },
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const prog = context.student?.programs?.[eventCode] || {};
            const joinVal = prog.joinVY;
            const visible = prog.visible;

            if (joinVal !== true) {
                return promptLookup(context, 'joinRequired');
            }

            if (typeof visible !== 'boolean') {
                return promptLookup(context, 'yesNoRequired');
            }

            return null;
        }
    },
    'joinVY': {
        id: 'joinVY',
        type: 'custom',
        component: RenderJoinVY as any,
        field: 'student.programs',
        promptKey: 'joinVY',
        condition: () => false
    },
    'visibleSignature': {
        id: 'visibleSignature',
        type: 'custom',
        component: RenderVisibleSignature as any,
        field: 'student.programs',
        promptKey: 'visibleSignature',
        condition: () => false
    },
    'socialMedia': {
        id: 'socialMedia',
        type: 'custom',
        component: RenderSocialMedia as any,
        field: 'student.programs',
        promptKey: 'socialMedia',
        validation: (value: any, context: ScriptContext): string | null => {
            const eventCode = context.event?.aid;
            if (!eventCode) return null;
            const checked = value?.[eventCode]?.socialMedia === true;
            if (!checked) return promptLookup(context, 'agreeRequired');
            return null;
        }
    },
    'save': {
        id: 'save',
        type: 'custom',
        component: RenderSave as any,
        field: null as any,
        promptKey: 'mustSave'
    },
    'join': {
        id: 'join',
        type: 'custom',
        component: RenderJoin as any,
        field: 'student',
        promptKey: 'join'
    },
    'motivation': {
        id: 'motivation',
        type: 'custom',
        component: RenderMotivation as any,
        field: 'student.programs',
        promptKey: 'motivation'
    },
    'oath': {
        id: 'oath',
        type: 'custom',
        component: RenderOath as any,
        field: 'student.programs',
        promptKey: 'oath'
    },
    'experienceBuddhism': {
        id: 'experienceBuddhism',
        type: 'radio',
        field: 'student.experience.buddhism',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ],
        promptKey: 'experienceBuddhism'
    },
};

/** Step key can be a string (id only) or { id, showWhen? } to override condition from script/event config */
export function getScriptSteps(stepKeys: (string | { id: string; showWhen?: StepConditionConfig })[]): ScriptStep[] {
    return stepKeys.map(entry => {
        const key = typeof entry === 'string' ? entry : entry.id;
        const step = stepRegistry[key];
        if (!step) {
            console.warn(`Step definition not found for key: ${key}`);
            return { id: key, type: 'info', promptKey: `Missing definition for ${key}` } as ScriptStep;
        }
        const base = { ...step };
        if (typeof entry === 'object' && entry.showWhen !== undefined) {
            base.showWhen = entry.showWhen;
        }
        return base;
    });
}
