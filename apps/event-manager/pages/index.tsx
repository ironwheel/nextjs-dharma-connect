import React, { useState, useEffect, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Button, Spinner, Modal, Badge, Accordion, Card as BootstrapCard } from "react-bootstrap";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Import sharedFrontend utilities
import {
    getAllTableItems,
    updateTableItem,
    getTableItemOrNull,
    deleteTableItem,
    putTableItem,
    VersionBadge,
    getVimeoShowcaseVideos,
    enableVimeoVideoPlayback,
    authGetConfigValue
} from 'sharedFrontend';

// Types
interface Event {
    aid: string;
    name: string;
    config?: any;
    embeddedEmails?: any;
    subEvents?: { [key: string]: SubEvent };
    list?: boolean;
    category?: string;
    [key: string]: any;
}

interface SubEvent {
    date?: string;
    embeddedEmails?: any;
    embeddedVideoList?: any[];
    embeddedShowcaseList?: string[];
    eventComplete?: boolean;
    eventOnDeck?: boolean;
    mediaNotify?: boolean;
    offeringMode?: string;
    rcpLevel?: number;
    regLinkAvailable?: boolean;
    timeString?: string;
    zoomLink?: string;
    [key: string]: any;
}

type PoolAttributeType =
    | 'true'
    | 'pool'
    | 'pooldiff'
    | 'pooland'
    | 'practice'
    | 'offering'
    | 'currenteventoffering'
    | 'currenteventtest'
    | 'currenteventnotoffering'
    | 'offeringandpools'
    | 'oath'
    | 'attended'
    | 'join'
    | 'currenteventjoin'
    | 'currenteventmanualinclude'
    | 'currenteventaccepted'
    | 'currenteventnotjoin'
    | 'joinwhich'
    | 'offeringwhich'
    | 'eligible';

interface PoolAttribute {
    type: PoolAttributeType;
    // Common / legacy fields
    name?: string;
    aid?: string;
    // Pool composition
    inpool?: string;
    outpool?: string;
    pool1?: string;
    pool2?: string;
    pools?: string[];
    // Practice-based
    field?: string;
    // Program / event context
    subevent?: string;
    retreat?: string;
}

interface Pool {
    name: string;
    description?: string;
    attributes?: PoolAttribute[];
    [key: string]: any;
}

interface Script {
    name: string;
    steps: string[];
    [key: string]: any;
}

interface OfferingConfig {
    oid: string;
    amounts: number[];
    fees: number[];
    prompts: string[];
    [key: string]: any;
}

interface Prompt {
    prompt: string; // Composite key: aid-promptName (e.g., "sw2023-nextOnly")
    language: string; // Sort key
    aid: string; // Event code extracted from prompt field
    text: string; // The actual prompt text
    [key: string]: any;
}

interface PromptGroup {
    aid: string;
    prompts: Prompt[];
    eventName?: string;
    eventDate?: string;
}

interface View {
    name: string;
    columnDefs: Array<{
        name: string;
        headerName?: string;
        boolName?: string;
        stringName?: string;
        numberName?: string;
        pool?: string;
        aid?: string;
        map?: string;
        writeEnabled?: boolean;
    }>;
    viewConditions: Array<{
        name: string;
        boolName?: string;
        boolValue?: boolean;
        stringValue?: string;
        pool?: string;
        map?: string;
    }>;
}

type ResourceType = 'prompts' | 'events' | 'pools' | 'scripts' | 'offerings' | 'views';

// Available script step definitions (from join.js stepDefs)
const AVAILABLE_SCRIPT_STEPS = [
    'writtenTranslation', 'spokenTranslation', 'location', 'experienceMeditation', 'experienceBuddhism', 'motivation',
    'supplication', 'supplicationMY', 'supplicationAB', 'supplicationVY',
    'joinMY', 'joinAB', 'joinVY', 'join', 'visibleSignature', 'shareEmail',
    'socialMedia', 'selfCare', 'refugeVow', 'preRefugeVow', 'refugeSupplication',
    'refugeReminder', 'bodhiVow', 'bodhiSupplication', 'shambhalaVow', 'societyVow',
    'references', 'save', 'currentPractice', 'vajrayanaStudent', 'newSamaya',
    'vajrayanaCommitment', 'vajrayanaTransmission', 'retreatAttend', 'prLung',
    'drgyLung', 'trueFreedomLung', 'whichRetreats', 'preferenceNecessity',
    'bothVYRetreats', 'vyOnlineSeries', 'mobilePhone', 'inPersonTeachings',
    'interestedInSetup', 'interestedInTakedown', 'healthcareProfessional',
    'serviceAlready', 'serviceContact', 'service', 'serviceNoQuestion',
    'accessiblity', 'dietary', 'sponsor', 'lrAcc', 'seriesCommitment',
    'abhishekaCommitment', 'optionalEvents', 'pilgrimageAccommodations',
    'roomate', 'preferSingle', 'readingTransmissions'
].sort();

// Module-level variables
let allEvents: Event[] = [];
let allPools: Pool[] = [];
let allScripts: Script[] = [];
let allOfferings: OfferingConfig[] = [];
let allPrompts: Prompt[] = [];
let promptGroups: PromptGroup[] = [];
let allViews: View[] = [];

// Autocomplete component for event codes
const EventCodeAutocomplete = ({ value, onChange, placeholder, label, id }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    id: string;
}) => {
    const [inputValue, setInputValue] = useState(value || '');
    const [isValid, setIsValid] = useState(true);
    const eventCodes = allEvents.map(e => e.aid).filter(Boolean).sort();
    const uniqueId = `event-code-${id}`;

    // Sync with external value changes
    React.useEffect(() => {
        setInputValue(value || '');
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);

        // Validate if value is in the list (only if not empty)
        if (newValue.trim()) {
            setIsValid(eventCodes.includes(newValue));
        } else {
            setIsValid(true);
        }
    };

    const handleBlur = () => {
        // On blur, validate and clear if invalid
        if (inputValue.trim() && !eventCodes.includes(inputValue)) {
            setIsValid(false);
            // Don't clear, but show error - user can see the issue
        }
    };

    return (
        <>
            {label && <Form.Label>{label}</Form.Label>}
            <Form.Control
                type="text"
                list={uniqueId}
                value={inputValue}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder={placeholder}
                isInvalid={!isValid && inputValue.trim() !== ''}
            />
            <datalist id={uniqueId}>
                {eventCodes.map(code => (
                    <option key={code} value={code} />
                ))}
            </datalist>
            {!isValid && inputValue.trim() !== '' && (
                <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                    Please select a valid event code from the list
                </Form.Control.Feedback>
            )}
        </>
    );
};

// Autocomplete component for pool names
const PoolNameAutocomplete = ({ value, onChange, placeholder, label, id, excludePoolName }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    id: string;
    excludePoolName?: string; // Exclude current pool name when editing
}) => {
    const [inputValue, setInputValue] = useState(value || '');
    const [isValid, setIsValid] = useState(true);
    const poolNames = allPools
        .map(p => p.name)
        .filter(Boolean)
        .filter(name => name !== excludePoolName) // Exclude current pool if editing
        .sort();
    const uniqueId = `pool-name-${id}`;

    // Sync with external value changes
    React.useEffect(() => {
        setInputValue(value || '');
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);

        // Validate if value is in the list (only if not empty)
        if (newValue.trim()) {
            setIsValid(poolNames.includes(newValue));
        } else {
            setIsValid(true);
        }
    };

    const handleBlur = () => {
        // On blur, validate
        if (inputValue.trim() && !poolNames.includes(inputValue)) {
            setIsValid(false);
        }
    };

    return (
        <>
            {label && <Form.Label>{label}</Form.Label>}
            <Form.Control
                type="text"
                list={uniqueId}
                value={inputValue}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder={placeholder}
                isInvalid={!isValid && inputValue.trim() !== ''}
            />
            <datalist id={uniqueId}>
                {poolNames.map(name => (
                    <option key={name} value={name} />
                ))}
            </datalist>
            {!isValid && inputValue.trim() !== '' && (
                <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                    Please select a valid pool name from the list
                </Form.Control.Feedback>
            )}
        </>
    );
};

// Autocomplete component for multiple pool names (comma-separated)
const PoolNamesAutocomplete = ({ value, onChange, placeholder, label, id }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    id: string;
}) => {
    const [inputValue, setInputValue] = useState(value || '');
    const poolNames = allPools.map(p => p.name).filter(Boolean).sort();
    const uniqueId = `pool-names-${id}`;

    // Sync with external value changes
    React.useEffect(() => {
        setInputValue(value || '');
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);
    };

    return (
        <>
            {label && <Form.Label>{label}</Form.Label>}
            <Form.Control
                type="text"
                list={uniqueId}
                value={inputValue}
                onChange={handleChange}
                placeholder={placeholder}
            />
            <datalist id={uniqueId}>
                {poolNames.map(name => (
                    <option key={name} value={name} />
                ))}
            </datalist>
            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                Type pool names separated by commas. Use autocomplete to select valid pools.
            </Form.Text>
        </>
    );
};

// Autocomplete component for subevent keys
const SubeventAutocomplete = ({ value, onChange, placeholder, label, id, eventAid }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    id: string;
    eventAid?: string;
}) => {
    const [inputValue, setInputValue] = useState(value || '');
    const [isValid, setIsValid] = useState(true);
    const uniqueId = `subevent-${id}`;

    // Get subevent keys from the selected event
    const getSubeventKeys = (): string[] => {
        if (!eventAid) return [];
        const event = allEvents.find(e => e.aid === eventAid);
        if (!event || !event.subEvents) return [];
        return Object.keys(event.subEvents).sort();
    };

    const subeventKeys = getSubeventKeys();
    // Include "any" as a special option
    const validOptions = ['any', ...subeventKeys];

    // Sync with external value changes
    React.useEffect(() => {
        setInputValue(value || '');
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);

        // Validate if value is in the list (only if not empty)
        if (newValue.trim()) {
            setIsValid(validOptions.includes(newValue));
        } else {
            setIsValid(true);
        }
    };

    const handleBlur = () => {
        // On blur, validate and show error if invalid
        if (inputValue.trim() && !validOptions.includes(inputValue)) {
            setIsValid(false);
        }
    };

    const isDisabled = !eventAid || eventAid.trim() === '';

    return (
        <>
            {label && <Form.Label>{label}</Form.Label>}
            <Form.Control
                type="text"
                list={uniqueId}
                value={inputValue}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder={isDisabled ? "Select an event first" : placeholder}
                disabled={isDisabled}
                isInvalid={!isValid && inputValue.trim() !== ''}
            />
            {!isDisabled && (
                <datalist id={uniqueId}>
                    {validOptions.map(key => (
                        <option key={key} value={key} />
                    ))}
                </datalist>
            )}
            {!isValid && inputValue.trim() !== '' && (
                <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                    Please select a valid subevent key from the list or use "any"
                </Form.Control.Feedback>
            )}
            {isDisabled && (
                <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                    Please select an event (aid) first to enable subevent selection
                </Form.Text>
            )}
        </>
    );
};

const Home = () => {
    const router = useRouter();
    const { pid, hash } = router.query;

    // State variables
    const [loaded, setLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const [currentResource, setCurrentResource] = useState<ResourceType>('events');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentUserName, setCurrentUserName] = useState<string>("Unknown");

    // Filtered lists
    const [filteredEvents, setFilteredEvents] = useState<Event[]>([]);
    const [filteredPools, setFilteredPools] = useState<Pool[]>([]);
    const [filteredScripts, setFilteredScripts] = useState<Script[]>([]);
    const [filteredOfferings, setFilteredOfferings] = useState<OfferingConfig[]>([]);
    const [filteredPromptGroups, setFilteredPromptGroups] = useState<PromptGroup[]>([]);
    const [filteredViews, setFilteredViews] = useState<View[]>([]);

    // Config data
    const [eventCategories, setEventCategories] = useState<string[]>([]);

    // Modal states
    const [showEventModal, setShowEventModal] = useState(false);
    const [showPoolModal, setShowPoolModal] = useState(false);
    const [showScriptModal, setShowScriptModal] = useState(false);
    const [showOfferingModal, setShowOfferingModal] = useState(false);
    const [showPromptsModal, setShowPromptsModal] = useState(false);
    const [showCreatePromptsModal, setShowCreatePromptsModal] = useState(false);
    const [showSavingPromptsModal, setShowSavingPromptsModal] = useState(false);
    const [showSubEventModal, setShowSubEventModal] = useState(false);
    const [showViewsModal, setShowViewsModal] = useState(false);
    const [showDeleteEventConfirm, setShowDeleteEventConfirm] = useState(false);
    const [showDeletePoolConfirm, setShowDeletePoolConfirm] = useState(false);
    const [showDeleteScriptConfirm, setShowDeleteScriptConfirm] = useState(false);
    const [showDeleteOfferingConfirm, setShowDeleteOfferingConfirm] = useState(false);
    const [showDeleteViewConfirm, setShowDeleteViewConfirm] = useState(false);
    const [isNewEvent, setIsNewEvent] = useState(false);
    const [isNewPool, setIsNewPool] = useState(false);
    const [isNewScript, setIsNewScript] = useState(false);
    const [isNewOffering, setIsNewOffering] = useState(false);
    const [isNewSubEvent, setIsNewSubEvent] = useState(false);
    const [isNewView, setIsNewView] = useState(false);
    const [isDuplicatingPrompts, setIsDuplicatingPrompts] = useState(false);

    // Selected items
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
    const [selectedScript, setSelectedScript] = useState<Script | null>(null);
    const [selectedOffering, setSelectedOffering] = useState<OfferingConfig | null>(null);
    const [selectedPromptGroup, setSelectedPromptGroup] = useState<PromptGroup | null>(null);
    const [selectedView, setSelectedView] = useState<View | null>(null);
    const [selectedSubEventKey, setSelectedSubEventKey] = useState<string>('');

    // Form data for editing
    const [eventFormData, setEventFormData] = useState<Event>({
        aid: '',
        name: '',
        config: {},
        subEvents: {}
    });

    const [poolFormData, setPoolFormData] = useState<Pool>({
        name: '',
        description: '',
        attributes: []
    });

    const [scriptFormData, setScriptFormData] = useState<Script>({
        name: '',
        steps: []
    });

    const [offeringFormData, setOfferingFormData] = useState<OfferingConfig>({
        oid: '',
        amounts: [0, 0, 0, 0, 0],
        fees: [0, 0, 0, 0, 0],
        prompts: []
    });

    const [viewFormData, setViewFormData] = useState<View>({
        name: '',
        columnDefs: [],
        viewConditions: []
    });

    const [subEventFormData, setSubEventFormData] = useState<SubEvent>({
        date: '',
        eventComplete: false,
        eventOnDeck: false,
        mediaNotify: false,
        regLinkAvailable: false,
        embeddedShowcaseList: ['']
    });
    const [perLanguageShowcases, setPerLanguageShowcases] = useState<boolean>(false);
    const [processingShowcaseIndex, setProcessingShowcaseIndex] = useState<number | null>(null);

    // Prompt editing state
    const [promptsEditAid, setPromptsEditAid] = useState<string>('');
    const [promptsEditData, setPromptsEditData] = useState<Prompt[]>([]);
    const [promptsFindText, setPromptsFindText] = useState<string>('');
    const [promptsReplaceText, setPromptsReplaceText] = useState<string>('');
    // Create prompts state
    const [createPromptsAid, setCreatePromptsAid] = useState<string>('');
    const [createPromptsTemplate, setCreatePromptsTemplate] = useState<string>('basicSupplication');
    const [viewsProfileKeys, setViewsProfileKeys] = useState<string[]>([]);

    const initialLoadStarted = useRef(false);
    const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);

    // Fetch data functions
    const fetchEvents = async () => {
        try {
            const events = await getAllTableItems('events', pid as string, hash as string);
            if (events && 'redirected' in events) {
                console.log('Events fetch redirected - authentication required');
                return [];
            }
            return events as Event[];
        } catch (error) {
            console.error('Error fetching events:', error);
            toast.error('Failed to fetch events');
            return [];
        }
    };

    const fetchPools = async () => {
        try {
            const pools = await getAllTableItems('pools', pid as string, hash as string);
            if (pools && 'redirected' in pools) {
                console.log('Pools fetch redirected - authentication required');
                return [];
            }
            return pools as Pool[];
        } catch (error) {
            console.error('Error fetching pools:', error);
            toast.error('Failed to fetch pools');
            return [];
        }
    };

    const fetchScripts = async () => {
        try {
            const scripts = await getAllTableItems('scripts', pid as string, hash as string);
            if (scripts && 'redirected' in scripts) {
                console.log('Scripts fetch redirected - authentication required');
                return [];
            }
            return scripts as Script[];
        } catch (error) {
            console.error('Error fetching scripts:', error);
            toast.error('Failed to fetch scripts');
            return [];
        }
    };

    const fetchOfferings = async () => {
        try {
            const offerings = await getAllTableItems('offering-config', pid as string, hash as string);
            if (offerings && 'redirected' in offerings) {
                console.log('Offerings fetch redirected - authentication required');
                return [];
            }
            return offerings as OfferingConfig[];
        } catch (error) {
            console.error('Error fetching offerings:', error);
            toast.error('Failed to fetch offerings');
            return [];
        }
    };

    const fetchPrompts = async () => {
        try {
            const prompts = await getAllTableItems('prompts', pid as string, hash as string);
            if (prompts && 'redirected' in prompts) {
                console.log('Prompts fetch redirected - authentication required');
                return [];
            }
            return prompts as Prompt[];
        } catch (error) {
            console.error('Error fetching prompts:', error);
            toast.error('Failed to fetch prompts');
            return [];
        }
    };

    const fetchViews = async () => {
        try {
            const views = await getAllTableItems('views', pid as string, hash as string);
            if (views && 'redirected' in views) {
                console.log('Views fetch redirected - authentication required');
                return [];
            }
            return views as View[];
        } catch (error) {
            console.error('Error fetching views:', error);
            toast.error('Failed to fetch views');
            return [];
        }
    };

    const fetchCategories = async () => {
        try {
            // 1. Try authGetConfigValue first as requested
            const categories = await authGetConfigValue(pid as string, hash as string, 'eventCategoryList');

            if (categories && categories.redirected) {
                return [];
            }

            if (Array.isArray(categories) && categories.length > 0) {
                return categories;
            }

            // 2. Fallback: Try fetching directly from config table using the key 'eventCategoryList'
            // This handles cases where the data is in the config table but not exposed via the auth/host config path
            const configItem = await getTableItemOrNull('config', 'eventCategoryList', pid as string, hash as string);

            if (configItem) {
                if (Array.isArray(configItem.value)) return configItem.value;
                if (Array.isArray(configItem.list)) return configItem.list;
                if (Array.isArray(configItem.categories)) return configItem.categories;
                // Check if the item itself has a property with the same name as the key
                if (Array.isArray(configItem.eventCategoryList)) return configItem.eventCategoryList;
            }

            return [];
        } catch (error) {
            console.error('Error fetching categories:', error);
            return [];
        }
    };

    // Group prompts by aid and enrich with event data
    const groupPromptsByAid = () => {
        const groups: { [aid: string]: Prompt[] } = {};

        // Group prompts by aid
        allPrompts.forEach(prompt => {
            // Extract aid from the prompt field (format: aid-promptName)
            const parts = prompt.prompt.split('-');
            const aid = parts[0];

            if (!groups[aid]) {
                groups[aid] = [];
            }
            groups[aid].push({ ...prompt, aid });
        });

        // Convert to array and enrich with event data
        const groupsArray: PromptGroup[] = Object.keys(groups).map(aid => {
            const event = allEvents.find(e => e.aid === aid);
            const earliestDate = event ? getEarliestEventDate(event) : null;

            return {
                aid,
                prompts: groups[aid],
                eventName: event?.name,
                eventDate: earliestDate
                    ? earliestDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : undefined
            };
        });

        // Sort alphabetically by aid
        groupsArray.sort((a, b) => a.aid.localeCompare(b.aid));

        promptGroups = groupsArray;
        return groupsArray;
    };

    // Helper function to get the earliest date from an event's subevents
    const getEarliestEventDate = (event: Event): Date | null => {
        if (!event.subEvents || Object.keys(event.subEvents).length === 0) {
            return null;
        }

        const dates = Object.values(event.subEvents)
            .map(subEvent => subEvent.date)
            .filter(date => date)
            .map(date => {
                // Parse date string as local date to avoid timezone issues
                // Date format is expected to be "YYYY-MM-DD"
                const dateStr = date as string;
                const [year, month, day] = dateStr.split('-').map(Number);
                return new Date(year, month - 1, day);
            });

        if (dates.length === 0) return null;

        // Return the EARLIEST date (minimum)
        return new Date(Math.min(...dates.map(d => d.getTime())));
    };

    // Filter functions
    const filterEvents = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        let filtered = searchLower
            ? allEvents.filter(event =>
                event.aid.toLowerCase().includes(searchLower) ||
                event.name.toLowerCase().includes(searchLower)
            )
            : [...allEvents];

        // Sort by earliest date, descending (most recent earliest-date first)
        // Events without dates go to the end
        filtered.sort((a, b) => {
            const dateA = getEarliestEventDate(a);
            const dateB = getEarliestEventDate(b);

            if (!dateA && !dateB) return 0;
            if (!dateA) return 1; // Events without dates go to bottom
            if (!dateB) return -1; // Events without dates go to bottom

            // Most recent earliest-date first (descending)
            return dateB.getTime() - dateA.getTime();
        });

        setFilteredEvents(filtered);
    };

    const filterPools = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        if (!searchLower) {
            setFilteredPools(allPools);
            return;
        }
        const filtered = allPools.filter(pool =>
            pool.name.toLowerCase().includes(searchLower) ||
            (pool.description && pool.description.toLowerCase().includes(searchLower))
        );
        setFilteredPools(filtered);
    };

    const filterScripts = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        if (!searchLower) {
            setFilteredScripts(allScripts);
            return;
        }
        const filtered = allScripts.filter(script =>
            script.name.toLowerCase().includes(searchLower)
        );
        setFilteredScripts(filtered);
    };

    const filterOfferings = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        if (!searchLower) {
            setFilteredOfferings(allOfferings);
            return;
        }
        const filtered = allOfferings.filter(offering =>
            offering.oid.toLowerCase().includes(searchLower)
        );
        setFilteredOfferings(filtered);
    };

    const filterViews = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        if (!searchLower) {
            setFilteredViews(allViews);
            return;
        }
        const filtered = allViews.filter(view =>
            view.name.toLowerCase().includes(searchLower)
        );
        setFilteredViews(filtered);
    };

    const filterPromptGroups = (search: string) => {
        const searchLower = search.toLowerCase().trim();
        if (!searchLower) {
            setFilteredPromptGroups(promptGroups);
            return;
        }
        const filtered = promptGroups.filter(group =>
            group.aid.toLowerCase().includes(searchLower) ||
            (group.eventName && group.eventName.toLowerCase().includes(searchLower))
        );
        setFilteredPromptGroups(filtered);
    };

    const handleSearchChange = (value: string) => {
        setSearchTerm(value);
        if (currentResource === 'prompts') {
            filterPromptGroups(value);
        } else if (currentResource === 'events') {
            filterEvents(value);
        } else if (currentResource === 'pools') {
            filterPools(value);
        } else if (currentResource === 'scripts') {
            filterScripts(value);
        } else if (currentResource === 'offerings') {
            filterOfferings(value);
        } else if (currentResource === 'views') {
            filterViews(value);
        }
    };

    // Resource switching
    const handleResourceChange = (resource: ResourceType) => {
        setCurrentResource(resource);
        setSearchTerm('');
        if (resource === 'prompts') {
            filterPromptGroups('');
        } else if (resource === 'events') {
            filterEvents('');
        } else if (resource === 'pools') {
            filterPools('');
        } else if (resource === 'scripts') {
            filterScripts('');
        } else if (resource === 'offerings') {
            filterOfferings('');
        } else if (resource === 'views') {
            filterViews('');
        }
    };

    // Event handlers
    const handleCreateNew = async () => {
        if (currentResource === 'events') {
            setIsNewEvent(true);
            setEventFormData({
                aid: '',
                name: '',
                category: '',
                config: {
                    pool: '',
                    needAcceptance: false,
                    offeringKMFee: true,
                    offeringCADPar: false,
                    scriptName: '',
                    "lambda-url": "https://729jjip6ik.execute-api.us-east-1.amazonaws.com/prod"
                },
                subEvents: {},
                embeddedEmails: {}
            });

            // Fetch views-profiles 'default' record to get available keys
            // If this fails due to permissions, we'll continue without it
            try {
                const defaultProfile = await getTableItemOrNull('views-profiles', 'default', pid as string, hash as string);
                if (defaultProfile && defaultProfile.views && Array.isArray(defaultProfile.views)) {
                    setViewsProfileKeys(defaultProfile.views);
                } else {
                    setViewsProfileKeys([]);
                }
            } catch (error: any) {
                console.warn('Could not fetch views-profiles default (may be a permissions issue):', error?.message || error);
                // Continue without views profile keys - user can still manually enter dashboardViews
                setViewsProfileKeys([]);
            }

            setShowEventModal(true);
        } else if (currentResource === 'pools') {
            setIsNewPool(true);
            setPoolFormData({
                name: '',
                description: '',
                attributes: []
            });
            setShowPoolModal(true);
        } else if (currentResource === 'scripts') {
            setIsNewScript(true);
            setScriptFormData({
                name: '',
                steps: []
            });
            setShowScriptModal(true);
        } else if (currentResource === 'offerings') {
            setIsNewOffering(true);
            setOfferingFormData({
                oid: '',
                amounts: [0, 0, 0, 0, 0],
                fees: [0, 0, 0, 0, 0],
                prompts: []
            });
            setShowOfferingModal(true);
        } else if (currentResource === 'views') {
            setIsNewView(true);
            setViewFormData({
                name: '',
                columnDefs: [],
                viewConditions: []
            });
            setShowViewsModal(true);
        }
    };

    const handleEditEvent = async (event: Event) => {
        setIsNewEvent(false);
        setSelectedEvent(event);
        setEventFormData({ ...event });

        // Fetch views-profiles 'default' record to get available keys
        // If this fails due to permissions, we'll continue without it
        try {
            const defaultProfile = await getTableItemOrNull('views-profiles', 'default', pid as string, hash as string);
            if (defaultProfile && defaultProfile.views && Array.isArray(defaultProfile.views)) {
                setViewsProfileKeys(defaultProfile.views);
            } else {
                setViewsProfileKeys([]);
            }
        } catch (error: any) {
            console.warn('Could not fetch views-profiles default (may be a permissions issue):', error?.message || error);
            // Continue without views profile keys - user can still manually enter dashboardViews
            setViewsProfileKeys([]);
        }

        setShowEventModal(true);
    };

    const handleDuplicateEvent = (event: Event) => {
        // Deep copy the event
        const duplicatedEvent = JSON.parse(JSON.stringify(event));

        // Get current year
        const currentYear = new Date().getFullYear().toString();

        // Process aid field - look for YYYYMMDD pattern starting with 202X
        let newAid = duplicatedEvent.aid;
        const aidMatch = newAid.match(/(202\d)(\d{4})/);
        if (aidMatch) {
            // Replace year with current year and date with xxxx
            newAid = newAid.replace(aidMatch[0], `${currentYear}xxxx`);
        } else {
            // Just look for any 202X year pattern and replace
            newAid = newAid.replace(/202\d/g, currentYear);
        }
        duplicatedEvent.aid = newAid;

        // Process name field - replace any 202X with current year
        duplicatedEvent.name = duplicatedEvent.name.replace(/202\d/g, currentYear);

        // Process subEvents
        if (duplicatedEvent.subEvents) {
            Object.keys(duplicatedEvent.subEvents).forEach(key => {
                const subEvent = duplicatedEvent.subEvents[key];

                // Remove fields
                delete subEvent.embeddedEmails;
                delete subEvent.embeddedVideoList;
                delete subEvent.timeString;
                delete subEvent.zoomLink;

                // Blank out date and rcpLevel (set to empty/undefined, not delete)
                subEvent.date = '';
                subEvent.rcpLevel = undefined;

                // Set boolean flags to false
                subEvent.eventComplete = false;
                subEvent.eventOnDeck = false;
                subEvent.regLinkAvailable = false;
                subEvent.mediaNotify = false;
            });
        }

        // Remove top-level embeddedEmails
        delete duplicatedEvent.embeddedEmails;

        setIsNewEvent(true);
        setSelectedEvent(null);
        setEventFormData(duplicatedEvent);
        setShowEventModal(true);
        toast.info(`Creating duplicate of "${event.name}". Please review and modify the aid and other fields before saving.`);
    };

    const handleEditPool = (pool: Pool) => {
        setIsNewPool(false);
        setSelectedPool(pool);
        setPoolFormData({ ...pool });
        setShowPoolModal(true);
    };

    const handleEditScript = (script: Script) => {
        setIsNewScript(false);
        setSelectedScript(script);
        setScriptFormData({ ...script });
        setShowScriptModal(true);
    };

    const handleEditOffering = (offering: OfferingConfig) => {
        setIsNewOffering(false);
        setSelectedOffering(offering);
        setOfferingFormData({ ...offering });
        setShowOfferingModal(true);
    };

    const handleEditView = (view: View) => {
        setIsNewView(false);
        setSelectedView(view);
        setViewFormData({ ...view });
        setShowViewsModal(true);
    };

    const handleDuplicateView = (view: View) => {
        // Deep copy the view
        const duplicatedView = JSON.parse(JSON.stringify(view));

        // Generate a unique name
        let newName = `${duplicatedView.name}-copy`;
        let counter = 1;

        // Check if name already exists, increment counter until we find a unique name
        while (allViews.some(v => v.name === newName)) {
            newName = `${duplicatedView.name}-copy-${counter}`;
            counter++;
        }

        duplicatedView.name = newName;

        setIsNewView(true);
        setSelectedView(null);
        setViewFormData(duplicatedView);
        setShowViewsModal(true);
        toast.info(`Creating duplicate of "${view.name}". Please review and modify the name and other fields before saving.`);
    };

    const handleEditPrompts = (promptGroup: PromptGroup) => {
        setIsDuplicatingPrompts(false);
        setSelectedPromptGroup(promptGroup);
        setPromptsEditAid(promptGroup.aid);
        setPromptsEditData(JSON.parse(JSON.stringify(promptGroup.prompts))); // Deep copy
        setPromptsFindText('');
        setPromptsReplaceText('');
        setShowPromptsModal(true);
    };

    const handleDuplicatePrompts = (promptGroup: PromptGroup) => {
        setIsDuplicatingPrompts(true);
        setSelectedPromptGroup(promptGroup);

        // Get current year
        const currentYear = new Date().getFullYear().toString();

        // Process aid using same logic as event duplication
        let newAid = promptGroup.aid;
        let yearTransformationPattern: RegExp | null = null;
        let oldYear: string | null = null;

        const aidMatch = newAid.match(/(202\d)(\d{4})/);
        if (aidMatch) {
            oldYear = aidMatch[1]; // e.g., "2024"
            newAid = newAid.replace(aidMatch[0], `${currentYear}xxxx`);
            yearTransformationPattern = new RegExp(oldYear, 'g');
        } else {
            const yearMatch = newAid.match(/202\d/);
            if (yearMatch) {
                oldYear = yearMatch[0]; // e.g., "2024"
                newAid = newAid.replace(/202\d/g, currentYear);
                yearTransformationPattern = new RegExp(oldYear, 'g');
            }
        }

        // Deep copy prompts and apply transformations
        let duplicatedPrompts: Prompt[] = JSON.parse(JSON.stringify(promptGroup.prompts));

        // Remove emailSubjectReg and emailSubjectRegConfirm prompts
        duplicatedPrompts = duplicatedPrompts.filter(prompt => {
            const promptParts = prompt.prompt.split('-');
            const promptName = promptParts.slice(1).join('-');
            return promptName !== 'emailSubjectReg' && promptName !== 'emailSubjectRegConfirm';
        });

        // Apply year transformation to text fields if a pattern was detected
        if (yearTransformationPattern && oldYear) {
            duplicatedPrompts = duplicatedPrompts.map(prompt => ({
                ...prompt,
                text: prompt.text ? prompt.text.replace(yearTransformationPattern!, currentYear) : prompt.text
            }));
        }

        setPromptsEditAid(newAid);
        setPromptsEditData(duplicatedPrompts);
        setPromptsFindText('');
        setPromptsReplaceText('');
        setShowPromptsModal(true);
        toast.info(`Duplicating prompts from "${promptGroup.aid}". Review and modify before saving.`);
    };

    const handleReplaceAllInPrompts = () => {
        if (!promptsFindText) {
            toast.warning('Please enter text to find');
            return;
        }

        let replacementCount = 0;
        const updatedPrompts = promptsEditData.map(prompt => {
            if (prompt.text && prompt.text.includes(promptsFindText)) {
                const occurrences = (prompt.text.match(new RegExp(promptsFindText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                replacementCount += occurrences;
                return {
                    ...prompt,
                    text: prompt.text.split(promptsFindText).join(promptsReplaceText)
                };
            }
            return prompt;
        });

        setPromptsEditData(updatedPrompts);

        if (replacementCount > 0) {
            toast.success(`Replaced ${replacementCount} occurrence(s) of "${promptsFindText}"`);
        } else {
            toast.info(`No occurrences of "${promptsFindText}" found`);
        }
    };

    const handleSavePrompts = async () => {
        try {
            if (!promptsEditAid) {
                toast.error('Event code (aid) is required');
                return;
            }

            // If duplicating, check for conflicts
            if (isDuplicatingPrompts) {
                const existingGroup = promptGroups.find(g => g.aid === promptsEditAid);
                if (existingGroup) {
                    toast.error(`Prompts for event "${promptsEditAid}" already exist. Please use a different event code.`);
                    return;
                }
            }

            // Show progress modal
            setShowSavingPromptsModal(true);

            // Save all prompts
            for (const prompt of promptsEditData) {
                // Extract promptName from original prompt field
                const originalParts = prompt.prompt.split('-');
                const promptName = originalParts.slice(1).join('-'); // Everything after first dash

                // Create new prompt object with updated prompt field
                const updatedPrompt = {
                    ...prompt,
                    prompt: `${promptsEditAid}-${promptName}`,
                    aid: promptsEditAid
                };

                await putTableItem('prompts', updatedPrompt.prompt, updatedPrompt, pid as string, hash as string);
            }

            toast.success(`Prompts ${isDuplicatingPrompts ? 'duplicated' : 'saved'} successfully`);

            // Refresh prompts
            const prompts = await fetchPrompts();
            allPrompts = Array.isArray(prompts) ? prompts : [];
            groupPromptsByAid();
            filterPromptGroups(searchTerm);

            // Close progress modal and edit modal
            setShowSavingPromptsModal(false);
            setShowPromptsModal(false);
        } catch (error) {
            console.error('Error saving prompts:', error);
            toast.error('Failed to save prompts');
            setShowSavingPromptsModal(false);
        }
    };

    const handleCreatePrompts = async () => {
        try {
            if (!createPromptsAid) {
                toast.error('Event code (aid) is required');
                return;
            }

            if (!createPromptsTemplate) {
                toast.error('Template type is required');
                return;
            }

            // Check if prompts already exist for this aid
            const existingGroup = promptGroups.find(g => g.aid === createPromptsAid);
            if (existingGroup && existingGroup.prompts.length > 0) {
                toast.error(`Prompts for event "${createPromptsAid}" already exist. Please use a different event code.`);
                return;
            }

            // Define prompt templates
            const promptTemplates: { [key: string]: string[] } = {
                basicSupplication: ['receiptTitle', 'supplicationBody', 'supplicationTitle', 'title', 'event']
            };

            // Define languages
            const languages = ['Chinese', 'Czech', 'English', 'French', 'German', 'Italian', 'Portuguese', 'Spanish'];

            // Get prompt names for the selected template
            const promptNames = promptTemplates[createPromptsTemplate] || [];
            if (promptNames.length === 0) {
                toast.error(`Template "${createPromptsTemplate}" not found`);
                return;
            }

            // Define pre-seeded text for supplicationTitle by language
            const supplicationTitleTexts: { [key: string]: string } = {
                'Chinese': '祈求传授教义（作者：xxxxxx）',
                'Czech': 'Prosba (Napsána xxxxx)',
                'English': 'Supplication for Teachings (written by xxxxx)',
                'French': 'Supplique (Écrite par xxxxx)',
                'German': 'Bittgesuch (Verfasst von xxxxx)',
                'Italian': 'Supplica (Scritto da xxxxx)',
                'Portuguese': 'Súplica (Escrito por xxxxx)',
                'Spanish': 'Súplica (Escrita por xxxxx)'
            };

            // Create prompts for each combination of prompt name and language
            const promptsToCreate: Prompt[] = [];
            for (const promptName of promptNames) {
                for (const language of languages) {
                    // Pre-seed text for supplicationTitle, otherwise use empty string
                    const text = promptName === 'supplicationTitle'
                        ? (supplicationTitleTexts[language] || '')
                        : '';

                    promptsToCreate.push({
                        prompt: `${createPromptsAid}-${promptName}`,
                        language: language,
                        aid: createPromptsAid,
                        text: text
                    });
                }
            }

            // Save all prompts
            for (const prompt of promptsToCreate) {
                await putTableItem('prompts', prompt.prompt, prompt, pid as string, hash as string);
            }

            toast.success(`Created ${promptsToCreate.length} prompts for ${createPromptsAid} successfully`);

            // Refresh prompts
            const prompts = await fetchPrompts();
            allPrompts = Array.isArray(prompts) ? prompts : [];
            groupPromptsByAid();
            filterPromptGroups(searchTerm);

            // Reset form and close create modal
            const createdAid = createPromptsAid;
            setCreatePromptsAid('');
            setCreatePromptsTemplate('basicSupplication');
            setShowCreatePromptsModal(false);

            // Find the newly created prompt group and open edit modal
            const newGroup = promptGroups.find(g => g.aid === createdAid);
            if (newGroup) {
                handleEditPrompts(newGroup);
            }
        } catch (error) {
            console.error('Error creating prompts:', error);
            toast.error('Failed to create prompts');
        }
    };

    const handleSaveEvent = async () => {
        try {
            if (!eventFormData.aid || !eventFormData.name) {
                toast.error('Event code (aid) and name are required');
                return;
            }

            // Validation: Check for conflicts with existing events
            if (isNewEvent) {
                // Check if aid already exists
                const existingEventWithAid = allEvents.find(e => e.aid === eventFormData.aid);
                if (existingEventWithAid) {
                    toast.error(`An event with the code "${eventFormData.aid}" already exists. Please use a different event code.`);
                    return;
                }

                // Check if name already exists
                const existingEventWithName = allEvents.find(e => e.name === eventFormData.name);
                if (existingEventWithName) {
                    toast.error(`An event with the name "${eventFormData.name}" already exists. Please use a different name.`);
                    return;
                }

                // Check for subevent date conflicts
                if (eventFormData.subEvents) {
                    for (const [subEventKey, subEvent] of Object.entries(eventFormData.subEvents)) {
                        if (subEvent.date) {
                            // Check all existing events for this date
                            for (const existingEvent of allEvents) {
                                if (existingEvent.subEvents) {
                                    for (const [existingSubKey, existingSubEvent] of Object.entries(existingEvent.subEvents)) {
                                        if (existingSubEvent.date === subEvent.date) {
                                            toast.error(
                                                `Conflict: SubEvent "${subEventKey}" has date ${subEvent.date} which conflicts with ` +
                                                `event "${existingEvent.aid}" subevent "${existingSubKey}". ` +
                                                `Please use a different date.`
                                            );
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Ensure lambda-url is always set
            if (!eventFormData.config) {
                eventFormData.config = {};
            }
            if (!eventFormData.config['lambda-url']) {
                eventFormData.config['lambda-url'] = "https://729jjip6ik.execute-api.us-east-1.amazonaws.com/prod";
            }

            // Remove dashboardViews if it's empty
            const configToSave = { ...eventFormData.config };
            if (configToSave.dashboardViews) {
                const dashboardViews = configToSave.dashboardViews;
                const hasAnyValues = Object.values(dashboardViews).some(value => {
                    const strValue = typeof value === 'string' ? value : String(value || '');
                    return strValue && strValue.trim() !== '';
                });
                if (!hasAnyValues) {
                    delete configToSave.dashboardViews;
                }
            }

            const eventToSave = {
                ...eventFormData,
                config: configToSave
            };

            await putTableItem('events', eventFormData.aid, eventToSave, pid as string, hash as string);
            toast.success('Event saved successfully');

            // Refresh events list
            const events = await fetchEvents();
            allEvents = Array.isArray(events) ? events : [];
            filterEvents(searchTerm);

            setShowEventModal(false);
        } catch (error) {
            console.error('Error saving event:', error);
            toast.error('Failed to save event');
        }
    };

    const handleSavePool = async () => {
        try {
            if (!poolFormData.name) {
                toast.error('Pool name (code) is required');
                return;
            }

            await putTableItem('pools', poolFormData.name, poolFormData, pid as string, hash as string);
            toast.success('Pool saved successfully');

            // Refresh pools list
            const pools = await fetchPools();
            allPools = Array.isArray(pools) ? pools : [];
            filterPools(searchTerm);

            setShowPoolModal(false);
        } catch (error) {
            console.error('Error saving pool:', error);
            toast.error('Failed to save pool');
        }
    };

    const handleSaveScript = async () => {
        try {
            if (!scriptFormData.name) {
                toast.error('Script name is required');
                return;
            }

            await putTableItem('scripts', scriptFormData.name, scriptFormData, pid as string, hash as string);
            toast.success('Script saved successfully');

            // Refresh scripts list
            const scripts = await fetchScripts();
            allScripts = Array.isArray(scripts) ? scripts : [];
            filterScripts(searchTerm);

            setShowScriptModal(false);
        } catch (error) {
            console.error('Error saving script:', error);
            toast.error('Failed to save script');
        }
    };

    const handleSaveOffering = async () => {
        try {
            if (!offeringFormData.oid) {
                toast.error('Offering ID (oid) is required');
                return;
            }

            await putTableItem('offering-config', offeringFormData.oid, offeringFormData, pid as string, hash as string);
            toast.success('Offering saved successfully');

            // Refresh offerings list
            const offerings = await fetchOfferings();
            allOfferings = Array.isArray(offerings) ? offerings : [];
            filterOfferings(searchTerm);

            setShowOfferingModal(false);
        } catch (error) {
            console.error('Error saving offering:', error);
            toast.error('Failed to save offering');
        }
    };

    const handleDeleteEvent = async () => {
        if (!selectedEvent) return;

        try {
            await deleteTableItem('events', selectedEvent.aid, pid as string, hash as string);
            toast.success('Event deleted successfully');

            // Close modals
            setShowDeleteEventConfirm(false);
            setShowEventModal(false);

            // Refresh events list
            const events = await fetchEvents();
            allEvents = Array.isArray(events) ? events : [];
            filterEvents(searchTerm);
        } catch (error) {
            console.error('Error deleting event:', error);
            toast.error('Failed to delete event');
        }
    };

    const handleDeletePool = async () => {
        if (!selectedPool) return;

        try {
            await deleteTableItem('pools', selectedPool.name, pid as string, hash as string);
            toast.success('Pool deleted successfully');

            // Close modals
            setShowDeletePoolConfirm(false);
            setShowPoolModal(false);

            // Refresh pools list
            const pools = await fetchPools();
            allPools = Array.isArray(pools) ? pools : [];
            filterPools(searchTerm);
        } catch (error) {
            console.error('Error deleting pool:', error);
            toast.error('Failed to delete pool');
        }
    };

    const handleDeleteScript = async () => {
        if (!selectedScript) return;

        try {
            await deleteTableItem('scripts', selectedScript.name, pid as string, hash as string);
            toast.success('Script deleted successfully');

            // Close modals
            setShowDeleteScriptConfirm(false);
            setShowScriptModal(false);

            // Refresh scripts list
            const scripts = await fetchScripts();
            allScripts = Array.isArray(scripts) ? scripts : [];
            filterScripts(searchTerm);
        } catch (error) {
            console.error('Error deleting script:', error);
            toast.error('Failed to delete script');
        }
    };

    const handleDeleteOffering = async () => {
        if (!selectedOffering) return;

        try {
            await deleteTableItem('offering-config', selectedOffering.oid, pid as string, hash as string);
            toast.success('Offering deleted successfully');

            // Close modals
            setShowDeleteOfferingConfirm(false);
            setShowOfferingModal(false);

            // Refresh offerings list
            const offerings = await fetchOfferings();
            allOfferings = Array.isArray(offerings) ? offerings : [];
            filterOfferings(searchTerm);
        } catch (error) {
            console.error('Error deleting offering:', error);
            toast.error('Failed to delete offering');
        }
    };

    // SubEvent handlers
    const handleAddSubEvent = () => {
        setIsNewSubEvent(true);
        setSelectedSubEventKey('');
        setSubEventFormData({
            date: '',
            eventComplete: false,
            eventOnDeck: false,
            regLinkAvailable: false,
            embeddedShowcaseList: ['']
        });
        setPerLanguageShowcases(false);
        setProcessingShowcaseIndex(null);
        setShowSubEventModal(true);
    };

    const handleEditSubEvent = (key: string, subEvent: SubEvent) => {
        setIsNewSubEvent(false);
        setSelectedSubEventKey(key);
        setSubEventFormData({
            ...subEvent,
            embeddedShowcaseList: subEvent.embeddedShowcaseList && subEvent.embeddedShowcaseList.length > 0
                ? subEvent.embeddedShowcaseList
                : ['']
        });
        setPerLanguageShowcases(false);
        setProcessingShowcaseIndex(null);
        setShowSubEventModal(true);
    };

    const handleSaveSubEvent = () => {
        // Clean up empty showcase entries
        const cleanedData = { ...subEventFormData };
        if (cleanedData.embeddedShowcaseList) {
            cleanedData.embeddedShowcaseList = cleanedData.embeddedShowcaseList.filter(id => id && id.trim() !== '');
            // Remove embeddedShowcaseList if it's empty
            if (cleanedData.embeddedShowcaseList.length === 0) {
                delete cleanedData.embeddedShowcaseList;
            }
        }

        if (isNewSubEvent) {
            const key = prompt('Enter subevent key (e.g., "weekend1", "retreat"):');
            if (!key) return;

            setEventFormData(prev => ({
                ...prev,
                subEvents: {
                    ...prev.subEvents,
                    [key]: cleanedData
                }
            }));
        } else {
            setEventFormData(prev => ({
                ...prev,
                subEvents: {
                    ...prev.subEvents,
                    [selectedSubEventKey]: cleanedData
                }
            }));
        }
        setShowSubEventModal(false);
        toast.success('SubEvent updated (remember to save the event)');
    };

    const handleDeleteSubEvent = (key: string) => {
        if (window.confirm(`Are you sure you want to delete subevent "${key}"?`)) {
            const newSubEvents = { ...eventFormData.subEvents };
            delete newSubEvents[key];
            setEventFormData(prev => ({
                ...prev,
                subEvents: newSubEvents
            }));
            toast.success('SubEvent deleted (remember to save the event)');
        }
    };

    // Showcase handlers
    const handleAddShowcase = () => {
        setSubEventFormData(prev => ({
            ...prev,
            embeddedShowcaseList: [...(prev.embeddedShowcaseList || ['']), '']
        }));
    };

    const handleUpdateShowcase = (index: number, value: string) => {
        setSubEventFormData(prev => {
            const newList = [...(prev.embeddedShowcaseList || [''])];
            newList[index] = value;
            return {
                ...prev,
                embeddedShowcaseList: newList
            };
        });
    };

    const handleDeleteShowcase = (index: number) => {
        setSubEventFormData(prev => {
            const newList = [...(prev.embeddedShowcaseList || [''])];
            newList.splice(index, 1);
            if (newList.length === 0) {
                newList.push('');
            }
            return {
                ...prev,
                embeddedShowcaseList: newList
            };
        });
    };

    const handleProcessShowcase = async (index: number) => {
        const showcaseId = subEventFormData.embeddedShowcaseList?.[index];
        if (!showcaseId || !showcaseId.trim()) {
            toast.error('Please enter a showcase ID');
            return;
        }

        setProcessingShowcaseIndex(index);
        try {
            // Extract video IDs from showcase
            toast.info(`Processing showcase ${showcaseId}...`);
            const videoList = await getVimeoShowcaseVideos(
                showcaseId.trim(),
                perLanguageShowcases,
                pid as string,
                hash as string
            );

            if (videoList && 'redirected' in videoList) {
                toast.error('Authentication required');
                return;
            }

            // Ensure embeddedVideoList exists and has enough entries
            let embeddedVideoList = subEventFormData.embeddedVideoList || [];
            if (!Array.isArray(embeddedVideoList)) {
                embeddedVideoList = [];
            }

            let videoIds: string[] = [];

            if (perLanguageShowcases && Array.isArray(videoList)) {
                // Per-language mode: videos are array of {index, language, videoId}
                // Place each video at embeddedVideoList[video.index][language] = videoId
                for (const video of videoList as Array<{ index: number; language: string; videoId: string }>) {
                    // Ensure the target index exists
                    while (embeddedVideoList.length <= video.index) {
                        embeddedVideoList.push({});
                    }
                    // Ensure the object at this index exists
                    if (!embeddedVideoList[video.index]) {
                        embeddedVideoList[video.index] = {};
                    }
                    // Place the video
                    embeddedVideoList[video.index][video.language] = video.videoId;
                    videoIds.push(video.videoId);
                }
            } else {
                // Multi-language mode: videoList is { language: videoId, ... }
                // Place all videos at embeddedVideoList[index]
                while (embeddedVideoList.length <= index) {
                    embeddedVideoList.push({});
                }
                embeddedVideoList[index] = videoList as Record<string, string>;
                videoIds = Object.values(videoList as Record<string, string>);
            }

            // Enable each video for playback
            toast.info(`Enabling ${videoIds.length} video(s) for playback...`);

            for (const videoId of videoIds) {
                try {
                    await enableVimeoVideoPlayback(videoId, pid as string, hash as string);
                } catch (error: any) {
                    console.error(`Failed to enable video ${videoId}:`, error);
                    toast.warning(`Failed to enable video ${videoId}: ${error.message}`);
                }
            }

            // Update the form data
            setSubEventFormData(prev => ({
                ...prev,
                embeddedVideoList
            }));

            toast.success(`Successfully processed showcase ${showcaseId} and enabled ${videoIds.length} video(s)`);
        } catch (error: any) {
            console.error('Error processing showcase:', error);
            toast.error(`Failed to process showcase: ${error.message}`);
        } finally {
            setProcessingShowcaseIndex(null);
        }
    };

    // Pool attribute handlers
    const handleAddPoolAttribute = () => {
        setPoolFormData(prev => ({
            ...prev,
            attributes: [
                ...(prev.attributes || []),
                { type: 'pool', name: '' }
            ]
        }));
    };

    const handleUpdatePoolAttribute = (index: number, field: string, value: any) => {
        setPoolFormData(prev => {
            const newAttributes = [...(prev.attributes || [])];
            newAttributes[index] = {
                ...newAttributes[index],
                [field]: value
            };
            return {
                ...prev,
                attributes: newAttributes
            };
        });
    };

    const handleDeletePoolAttribute = (index: number) => {
        setPoolFormData(prev => ({
            ...prev,
            attributes: (prev.attributes || []).filter((_, i) => i !== index)
        }));
    };

    // View handlers
    const handleSaveView = async () => {
        if (!viewFormData.name.trim()) {
            toast.error('View name is required');
            return;
        }

        try {
            await putTableItem('views', viewFormData.name, viewFormData, pid as string, hash as string);
            toast.success('View saved successfully');

            // Close modal
            setShowViewsModal(false);

            // Refresh views list
            const views = await fetchViews();
            allViews = Array.isArray(views) ? views : [];
            filterViews(searchTerm);
        } catch (error) {
            console.error('Error saving view:', error);
            toast.error('Failed to save view');
        }
    };

    const handleDeleteView = async () => {
        if (!selectedView) return;

        try {
            await deleteTableItem('views', selectedView.name, pid as string, hash as string);
            toast.success('View deleted successfully');

            // Close modals
            setShowDeleteViewConfirm(false);
            setShowViewsModal(false);

            // Refresh views list
            const views = await fetchViews();
            allViews = Array.isArray(views) ? views : [];
            filterViews(searchTerm);
        } catch (error) {
            console.error('Error deleting view:', error);
            toast.error('Failed to delete view');
        }
    };

    const handleAddColumnDef = () => {
        setViewFormData(prev => ({
            ...prev,
            columnDefs: [...(prev.columnDefs || []), { name: '' }]
        }));
    };

    const handleUpdateColumnDef = (index: number, field: string, value: any) => {
        setViewFormData(prev => {
            const newColumnDefs = [...(prev.columnDefs || [])];
            newColumnDefs[index] = {
                ...newColumnDefs[index],
                [field]: value
            };
            return {
                ...prev,
                columnDefs: newColumnDefs
            };
        });
    };

    const handleDeleteColumnDef = (index: number) => {
        setViewFormData(prev => ({
            ...prev,
            columnDefs: (prev.columnDefs || []).filter((_, i) => i !== index)
        }));
    };

    const handleMoveColumnDefUp = (index: number) => {
        if (index === 0) return; // Can't move first item up
        setViewFormData(prev => {
            const newColumnDefs = [...(prev.columnDefs || [])];
            [newColumnDefs[index - 1], newColumnDefs[index]] = [newColumnDefs[index], newColumnDefs[index - 1]];
            return {
                ...prev,
                columnDefs: newColumnDefs
            };
        });
    };

    const handleMoveColumnDefDown = (index: number) => {
        setViewFormData(prev => {
            const columnDefs = prev.columnDefs || [];
            if (index >= columnDefs.length - 1) return prev; // Can't move last item down
            const newColumnDefs = [...columnDefs];
            [newColumnDefs[index], newColumnDefs[index + 1]] = [newColumnDefs[index + 1], newColumnDefs[index]];
            return {
                ...prev,
                columnDefs: newColumnDefs
            };
        });
    };

    const handleAddViewCondition = () => {
        setViewFormData(prev => ({
            ...prev,
            viewConditions: [...(prev.viewConditions || []), { name: 'currentAIDBool', boolValue: true }]
        }));
    };

    const handleUpdateViewCondition = (index: number, field: string, value: any) => {
        setViewFormData(prev => {
            const newViewConditions = [...(prev.viewConditions || [])];
            const currentCondition = { ...newViewConditions[index] };

            // If changing the condition type (name field), reset to appropriate structure
            if (field === 'name') {
                const newCondition: any = { name: value };

                // Preserve boolValue if it exists and is valid for the new type
                const boolValueTypes = ['currentAIDBool', 'currentAIDMapBool', 'baseBool', 'practiceBool', 'offering', 'deposit', 'spokenLanguage', 'writtenLanguage'];
                if (boolValueTypes.includes(value) && typeof currentCondition.boolValue !== 'undefined') {
                    newCondition.boolValue = currentCondition.boolValue;
                } else if (boolValueTypes.includes(value)) {
                    newCondition.boolValue = true; // Default to true
                }

                // Preserve relevant fields based on new type
                if (['currentAIDBool', 'baseBool', 'practiceBool'].includes(value)) {
                    // These need boolName - preserve if switching from similar type
                    if (['currentAIDBool', 'baseBool', 'practiceBool'].includes(currentCondition.name)) {
                        newCondition.boolName = currentCondition.boolName || '';
                    }
                } else if (value === 'currentAIDMapBool') {
                    // This needs map and boolName - preserve if switching from same type
                    if (currentCondition.name === 'currentAIDMapBool') {
                        newCondition.map = currentCondition.map || '';
                        newCondition.boolName = currentCondition.boolName || '';
                    }
                } else if (value === 'poolMember') {
                    // This needs pool - preserve if switching from same type
                    if (currentCondition.name === 'poolMember') {
                        newCondition.pool = currentCondition.pool || '';
                    }
                } else if (['spokenLanguage', 'writtenLanguage'].includes(value)) {
                    // These need stringValue - preserve if switching between language types
                    if (['spokenLanguage', 'writtenLanguage'].includes(currentCondition.name)) {
                        newCondition.stringValue = currentCondition.stringValue || '';
                    } else {
                        newCondition.stringValue = '';
                    }
                }

                newViewConditions[index] = newCondition;
            } else {
                // Normal field update
                newViewConditions[index] = {
                    ...currentCondition,
                    [field]: value
                };
            }

            return {
                ...prev,
                viewConditions: newViewConditions
            };
        });
    };

    const handleDeleteViewCondition = (index: number) => {
        setViewFormData(prev => ({
            ...prev,
            viewConditions: (prev.viewConditions || []).filter((_, i) => i !== index)
        }));
    };

    // Ensure JSON textarea maintains dark theme styles
    useEffect(() => {
        if (showEventModal && jsonTextareaRef.current) {
            const textarea = jsonTextareaRef.current;
            // Force apply dark theme styles immediately and on any changes
            const applyDarkTheme = () => {
                if (textarea) {
                    textarea.style.backgroundColor = '#2b2b2b';
                    textarea.style.color = 'white';
                    textarea.style.border = '1px solid #555';
                }
            };

            applyDarkTheme();

            // Reapply styles after short delays to catch any style resets from re-renders
            const timeouts = [
                setTimeout(applyDarkTheme, 50),
                setTimeout(applyDarkTheme, 150),
                setTimeout(applyDarkTheme, 300)
            ];

            // Set up an interval to check and reapply styles periodically while modal is open
            const intervalId = setInterval(() => {
                if (textarea && showEventModal) {
                    const computedBg = window.getComputedStyle(textarea).backgroundColor;
                    if (computedBg !== 'rgb(43, 43, 43)') {
                        applyDarkTheme();
                    }
                }
            }, 200);

            return () => {
                timeouts.forEach(clearTimeout);
                clearInterval(intervalId);
            };
        }
    }, [showEventModal, eventFormData.config]);

    // Main initialization effect
    useEffect(() => {
        if (!router.isReady || !pid || !hash) return;
        if (initialLoadStarted.current) return;

        initialLoadStarted.current = true;

        const loadInitialData = async () => {
            try {
                setLoadingProgress({ current: 0, total: 1, message: 'Starting data load...' });

                // Fetch all data
                const [events, pools, scripts, offerings, prompts, views] = await Promise.all([
                    fetchEvents(),
                    fetchPools(),
                    fetchScripts(),
                    fetchOfferings(),
                    fetchPrompts(),
                    fetchViews()
                ]);

                const eventsArray = Array.isArray(events) ? events : [];
                const poolsArray = Array.isArray(pools) ? pools : [];
                const scriptsArray = Array.isArray(scripts) ? scripts : [];
                const offeringsArray = Array.isArray(offerings) ? offerings : [];
                const promptsArray = Array.isArray(prompts) ? prompts : [];
                const viewsArray = Array.isArray(views) ? views : [];

                allEvents = eventsArray;
                allPools = poolsArray;
                allScripts = scriptsArray;
                allOfferings = offeringsArray;
                allPrompts = promptsArray;
                allViews = viewsArray;

                // Load categories
                const categories = await fetchCategories();
                setEventCategories(categories);

                // Group prompts by aid after events are loaded
                groupPromptsByAid();

                // Apply filters (which includes sorting) instead of setting directly
                filterEvents('');
                filterPromptGroups('');
                filterPools('');
                filterScripts('');
                filterOfferings('');
                filterViews('');

                console.log('Data loaded - Events:', eventsArray.length, 'Pools:', poolsArray.length, 'Scripts:', scriptsArray.length, 'Offerings:', offeringsArray.length, 'Prompts:', promptsArray.length, 'Views:', viewsArray.length);

                setLoaded(true);
            } catch (error) {
                console.error('Error loading initial data:', error);
                setErrMsg(error instanceof Error ? error.message : 'Unknown error');
                setLoaded(true);
            }
        };

        loadInitialData();
    }, [router.isReady, pid, hash]);

    // Error display
    if (errMsg) {
        return (
            <div className="loading-container" style={{ marginTop: '70px', minHeight: '200px' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', color: '#f87171', marginBottom: '10px' }}>
                        ⚠️ ERROR
                    </div>
                    <div style={{ fontSize: '18px', color: 'white' }}>
                        {errMsg}
                    </div>
                </div>
            </div>
        );
    }

    // Loading display
    if (!loaded) {
        return (
            <div className="loading-container" style={{ marginTop: '70px', minHeight: '400px' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: '32px', marginBottom: '20px', color: 'white', fontWeight: 'bold' }}>
                        Event Manager
                    </h1>
                    <b style={{ fontSize: '24px', marginBottom: '10px', display: 'block', color: 'white' }}>
                        {loadingProgress.message || 'Loading...'}
                    </b>
                    <Spinner animation="border" role="status" style={{ color: '#ffc107', width: '3rem', height: '3rem' }} />
                </div>
            </div>
        );
    }

    // Main render
    return (
        <>
            <ToastContainer />
            <Container style={{ marginTop: '20px', backgroundColor: 'transparent' }}>
                {/* Navigation Header */}
                <nav className="modern-navbar">
                    <div className="navbar-container">
                        <div className="navbar-left">
                            <h2 style={{ color: 'white', margin: 0 }}>Event Manager</h2>
                            {pid && hash && (
                                <Badge bg="secondary">
                                    <VersionBadge pid={pid as string} hash={hash as string} />
                                </Badge>
                            )}
                        </div>
                        <div className="navbar-right">
                            <input
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                type="text"
                                placeholder={`Search ${currentResource}...`}
                                className="search-input"
                            />
                            {currentResource === 'prompts' && (
                                <Button variant="warning" onClick={() => setShowCreatePromptsModal(true)}>
                                    + Create New Prompts
                                </Button>
                            )}
                            {currentResource !== 'prompts' && (
                                <Button variant="warning" onClick={handleCreateNew}>
                                    + Create New {currentResource === 'events' ? 'Event' : currentResource === 'pools' ? 'Pool' : currentResource === 'scripts' ? 'Script' : currentResource === 'offerings' ? 'Offering' : currentResource === 'views' ? 'View' : 'Item'}
                                </Button>
                            )}
                        </div>
                    </div>
                </nav>

                {/* Resource Selector */}
                <div className="resource-selector">
                    <button
                        className={`resource-button ${currentResource === 'events' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('events')}
                    >
                        Events ({allEvents.length})
                    </button>
                    <button
                        className={`resource-button ${currentResource === 'prompts' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('prompts')}
                    >
                        Prompts ({promptGroups.length})
                    </button>
                    <button
                        className={`resource-button ${currentResource === 'pools' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('pools')}
                    >
                        Eligibility Pools ({allPools.length})
                    </button>
                    <button
                        className={`resource-button ${currentResource === 'scripts' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('scripts')}
                    >
                        Scripts ({allScripts.length})
                    </button>
                    <button
                        className={`resource-button ${currentResource === 'offerings' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('offerings')}
                    >
                        Offerings ({allOfferings.length})
                    </button>
                    <button
                        className={`resource-button ${currentResource === 'views' ? 'active' : ''}`}
                        onClick={() => handleResourceChange('views')}
                    >
                        Views ({allViews.length})
                    </button>
                </div>

                {/* Prompts List */}
                {currentResource === 'prompts' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Prompts ({filteredPromptGroups.length} events)
                        </h4>
                        {filteredPromptGroups.map(group => (
                            <div key={group.aid} className="event-item">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleEditPrompts(group)}>
                                        <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                            {group.eventDate ? `${group.eventDate} - ` : ''}{group.eventName || group.aid}
                                        </h5>
                                        <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                            Code: {group.aid} • {group.prompts.length} prompts
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <Button
                                            variant="outline-warning"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDuplicatePrompts(group);
                                            }}
                                        >
                                            📋 Duplicate
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Events List */}
                {currentResource === 'events' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Events ({filteredEvents.length})
                        </h4>
                        {filteredEvents.map(event => {
                            const earliestDate = getEarliestEventDate(event);
                            const dateDisplay = event.list
                                ? 'List'
                                : (earliestDate
                                    ? earliestDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                    : 'No date');

                            return (
                                <div key={event.aid} className="event-item">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <div style={{ flex: 1 }} onClick={() => handleEditEvent(event)}>
                                            <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                                {dateDisplay} - {event.name}
                                            </h5>
                                            <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                                Code: {event.aid} • Pool: {event.config?.pool || 'Not set'}
                                                {!event.list && event.subEvents && ` • ${Object.keys(event.subEvents).length} subevents`}
                                                {!event.list && event.category && ` • Category: ${event.category}`}
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline-warning"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDuplicateEvent(event);
                                            }}
                                        >
                                            📋 Duplicate
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Pools List */}
                {currentResource === 'pools' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Eligibility Pools ({filteredPools.length})
                        </h4>
                        {filteredPools.map(pool => (
                            <div key={pool.name} className="pool-item" onClick={() => handleEditPool(pool)}>
                                <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                    {pool.name}
                                </h5>
                                {pool.description && (
                                    <div style={{ color: 'white', marginBottom: '0.5rem' }}>
                                        {pool.description}
                                    </div>
                                )}
                                <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                    {pool.attributes?.length || 0} attributes
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Scripts List */}
                {currentResource === 'scripts' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Scripts ({filteredScripts.length})
                        </h4>
                        {filteredScripts.map(script => (
                            <div key={script.name} className="pool-item" onClick={() => handleEditScript(script)}>
                                <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                    {script.name}
                                </h5>
                                <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                    {script.steps?.length || 0} steps
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Offerings List */}
                {currentResource === 'offerings' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Offerings ({filteredOfferings.length})
                        </h4>
                        {filteredOfferings.map(offering => (
                            <div key={offering.oid} className="pool-item" onClick={() => handleEditOffering(offering)}>
                                <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                    {offering.oid}
                                </h5>
                                <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                    {offering.amounts?.length || 0} price levels • {offering.prompts?.length || 0} prompts
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Views List */}
                {currentResource === 'views' && (
                    <div>
                        <h4 style={{ color: '#ffc107', marginBottom: '1rem' }}>
                            Views ({filteredViews.length})
                        </h4>
                        {filteredViews.map(view => (
                            <div key={view.name} className="pool-item">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                    <div style={{ flex: 1 }} onClick={() => handleEditView(view)}>
                                        <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                            {view.name}
                                        </h5>
                                        <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                            {view.columnDefs?.length || 0} columns • {view.viewConditions?.length || 0} conditions
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline-warning"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDuplicateView(view);
                                        }}
                                    >
                                        📋 Duplicate
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Container>

            {/* Event Edit Modal */}
            <Modal show={showEventModal} onHide={() => setShowEventModal(false)} size="xl">
                <Modal.Header closeButton>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>{isNewEvent ? 'Create New Event' : `Edit Event: ${eventFormData.aid}`}</span>
                        {!isNewEvent && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                                <Button
                                    variant="outline-warning"
                                    size="sm"
                                    onClick={() => {
                                        setShowEventModal(false);
                                        handleDuplicateEvent(selectedEvent!);
                                    }}
                                >
                                    📋 Duplicate
                                </Button>
                                <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => setShowDeleteEventConfirm(true)}
                                >
                                    🗑️ Delete
                                </Button>
                            </div>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        {/* Basic Event Info */}
                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Event Code (aid)*</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={eventFormData.aid}
                                            onChange={(e) => setEventFormData({ ...eventFormData, aid: e.target.value })}
                                            disabled={!isNewEvent}
                                            placeholder="e.g., vt2025"
                                            style={{
                                                backgroundColor: '#2b2b2b',
                                                color: !isNewEvent ? '#aaa' : 'white',
                                                border: '1px solid #555',
                                                cursor: !isNewEvent ? 'not-allowed' : 'text'
                                            }}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>{eventFormData.list ? 'List Name*' : 'Event Name (Description)*'}</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={eventFormData.name}
                                            onChange={(e) => setEventFormData({ ...eventFormData, name: e.target.value })}
                                            placeholder={eventFormData.list ? "e.g., Mailing List" : "e.g., Vermont In-Person Retreats 2025"}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                            {!eventFormData.list && (
                                <Row>
                                    <Col md={6}>
                                        <Form.Group className="mb-3">
                                            <Form.Label>Category</Form.Label>
                                            <Form.Control
                                                type="text"
                                                list="event-category-list"
                                                value={eventFormData.category || ''}
                                                onChange={(e) => setEventFormData({ ...eventFormData, category: e.target.value })}
                                                placeholder="Select or enter a category"
                                                style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                            />
                                            <datalist id="event-category-list">
                                                {eventCategories.map(cat => (
                                                    <option key={cat} value={cat} />
                                                ))}
                                            </datalist>
                                        </Form.Group>
                                    </Col>
                                </Row>
                            )}
                            <Row>
                                <Col md={12}>
                                    <Form.Group className="mb-3">
                                        <Form.Check
                                            type="checkbox"
                                            label={<span style={{ color: 'white' }}>This is a List (not an Event)</span>}
                                            checked={eventFormData.list || false}
                                            onChange={(e) => {
                                                const isList = e.target.checked;
                                                setEventFormData({
                                                    ...eventFormData,
                                                    list: isList,
                                                    // Clear subEvents when converting to list
                                                    subEvents: isList ? {} : eventFormData.subEvents
                                                });
                                            }}
                                        />
                                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                                            Lists are used for eligibility pools only and don't have subevents or event-specific configuration.
                                        </Form.Text>
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Eligibility Pool</Form.Label>
                                        <Form.Control
                                            type="text"
                                            list="event-pool-list"
                                            value={eventFormData.config?.pool || ''}
                                            onChange={(e) => setEventFormData({
                                                ...eventFormData,
                                                config: { ...eventFormData.config, pool: e.target.value }
                                            })}
                                            placeholder="Search or select a pool..."
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                        <datalist id="event-pool-list">
                                            {allPools.map(pool => (
                                                <option key={pool.name} value={pool.name}>
                                                    {pool.description ? `${pool.name} - ${pool.description}` : pool.name}
                                                </option>
                                            ))}
                                        </datalist>
                                    </Form.Group>
                                </Col>
                                {!eventFormData.list && (
                                    <Col md={6}>
                                        <Form.Group className="mb-3">
                                            <Form.Label>Script Name</Form.Label>
                                            <Form.Control
                                                type="text"
                                                list="event-script-list"
                                                value={eventFormData.config?.scriptName || ''}
                                                onChange={(e) => setEventFormData({
                                                    ...eventFormData,
                                                    config: { ...eventFormData.config, scriptName: e.target.value }
                                                })}
                                                placeholder="Search or select a script..."
                                                style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                            />
                                            <datalist id="event-script-list">
                                                {allScripts.map(script => (
                                                    <option key={script.name} value={script.name} />
                                                ))}
                                            </datalist>
                                        </Form.Group>
                                    </Col>
                                )}
                            </Row>
                            {!eventFormData.list && (
                                <Row>
                                    <Col md={4}>
                                        <Form.Group className="mb-3">
                                            <Form.Check
                                                type="checkbox"
                                                label={<span style={{ color: 'white' }}>Need Acceptance</span>}
                                                checked={eventFormData.config?.needAcceptance || false}
                                                onChange={(e) => setEventFormData({
                                                    ...eventFormData,
                                                    config: { ...eventFormData.config, needAcceptance: e.target.checked }
                                                })}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={4}>
                                        <Form.Group className="mb-3">
                                            <Form.Check
                                                type="checkbox"
                                                label={<span style={{ color: 'white' }}>Offering KM Fee</span>}
                                                checked={eventFormData.config?.offeringKMFee !== undefined ? eventFormData.config.offeringKMFee : true}
                                                onChange={(e) => setEventFormData({
                                                    ...eventFormData,
                                                    config: { ...eventFormData.config, offeringKMFee: e.target.checked }
                                                })}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={4}>
                                        <Form.Group className="mb-3">
                                            <Form.Check
                                                type="checkbox"
                                                label={<span style={{ color: 'white' }}>Offering CAD Par</span>}
                                                checked={eventFormData.config?.offeringCADPar || false}
                                                onChange={(e) => setEventFormData({
                                                    ...eventFormData,
                                                    config: { ...eventFormData.config, offeringCADPar: e.target.checked }
                                                })}
                                            />
                                        </Form.Group>
                                    </Col>
                                </Row>
                            )}

                            {/* Dashboard Views Section */}
                            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #555' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h5 style={{ color: '#ffc107', margin: 0 }}>Dashboard Views</h5>
                                    {viewsProfileKeys.length > 0 && (
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <Form.Select
                                                size="sm"
                                                style={{ width: 'auto', backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                                onChange={(e) => {
                                                    const selectedKey = e.target.value;
                                                    if (selectedKey) {
                                                        const dashboardViews = eventFormData.config?.dashboardViews || {};
                                                        if (!dashboardViews[selectedKey]) {
                                                            const newDashboardViews = {
                                                                ...dashboardViews,
                                                                [selectedKey]: ''
                                                            };
                                                            setEventFormData({
                                                                ...eventFormData,
                                                                config: {
                                                                    ...eventFormData.config,
                                                                    dashboardViews: newDashboardViews
                                                                }
                                                            });
                                                            e.target.value = ''; // Reset select
                                                        } else {
                                                            toast.info(`Profile key "${selectedKey}" is already mapped`);
                                                            e.target.value = ''; // Reset select
                                                        }
                                                    }
                                                }}
                                                defaultValue=""
                                            >
                                                <option value="">+ Add View Mapping</option>
                                                {viewsProfileKeys
                                                    .filter(key => !eventFormData.config?.dashboardViews?.[key])
                                                    .map(key => (
                                                        <option key={key} value={key}>{key}</option>
                                                    ))}
                                            </Form.Select>
                                        </div>
                                    )}
                                </div>
                                {eventFormData.config?.dashboardViews && Object.keys(eventFormData.config.dashboardViews).length > 0 ? (
                                    Object.entries(eventFormData.config.dashboardViews).map(([profileKey, viewName]) => (
                                        <Row key={profileKey} className="mb-3">
                                            <Col md={5}>
                                                <Form.Group>
                                                    <Form.Label>Profile Key</Form.Label>
                                                    <Form.Control
                                                        type="text"
                                                        value={profileKey}
                                                        disabled
                                                        style={{
                                                            backgroundColor: '#1a1a1a',
                                                            color: '#aaa',
                                                            border: '1px solid #555',
                                                            cursor: 'not-allowed'
                                                        }}
                                                    />
                                                </Form.Group>
                                            </Col>
                                            <Col md={6}>
                                                <Form.Group>
                                                    <Form.Label>View Name</Form.Label>
                                                    <Form.Control
                                                        type="text"
                                                        list={`view-name-${profileKey}`}
                                                        value={viewName as string || ''}
                                                        onChange={(e) => {
                                                            const dashboardViews = { ...eventFormData.config?.dashboardViews };
                                                            dashboardViews[profileKey] = e.target.value;
                                                            setEventFormData({
                                                                ...eventFormData,
                                                                config: {
                                                                    ...eventFormData.config,
                                                                    dashboardViews
                                                                }
                                                            });
                                                        }}
                                                        placeholder="Select view"
                                                    />
                                                    <datalist id={`view-name-${profileKey}`}>
                                                        {allViews.map(view => (
                                                            <option key={view.name} value={view.name} />
                                                        ))}
                                                    </datalist>
                                                </Form.Group>
                                            </Col>
                                            <Col md={1} style={{ display: 'flex', alignItems: 'end', paddingBottom: '0.5rem' }}>
                                                <Button
                                                    variant="outline-danger"
                                                    size="sm"
                                                    onClick={() => {
                                                        const dashboardViews = { ...eventFormData.config?.dashboardViews };
                                                        delete dashboardViews[profileKey];
                                                        const newConfig = { ...eventFormData.config };
                                                        if (Object.keys(dashboardViews).length === 0) {
                                                            delete newConfig.dashboardViews;
                                                        } else {
                                                            newConfig.dashboardViews = dashboardViews;
                                                        }
                                                        setEventFormData({
                                                            ...eventFormData,
                                                            config: newConfig
                                                        });
                                                    }}
                                                >
                                                    ×
                                                </Button>
                                            </Col>
                                        </Row>
                                    ))
                                ) : (
                                    <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                        No dashboard view mappings. Click "+ Add View Mapping" to add one.
                                    </div>
                                )}
                                {viewsProfileKeys.length === 0 && (
                                    <div style={{ color: '#ffc107', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                        Note: View profile keys not available. You can still manually configure dashboardViews in the Advanced Configuration section below, or ensure IAM permissions allow access to the views-profiles table.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Coordinator Emails Section */}
                        <div className="card" style={{ marginTop: '1.5rem' }}>
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Coordinator Emails</h5>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Coordinator Email (Americas)</Form.Label>
                                        <Form.Control
                                            type="email"
                                            value={eventFormData.config?.coordEmailAmericas || ''}
                                            onChange={(e) => {
                                                setEventFormData({
                                                    ...eventFormData,
                                                    config: {
                                                        ...eventFormData.config,
                                                        coordEmailAmericas: e.target.value
                                                    }
                                                });
                                            }}
                                            placeholder="americas-coordinator@example.com"
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                            Email address for Americas coordinator
                                        </Form.Text>
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Coordinator Email (Europe)</Form.Label>
                                        <Form.Control
                                            type="email"
                                            value={eventFormData.config?.coordEmailEurope || ''}
                                            onChange={(e) => {
                                                setEventFormData({
                                                    ...eventFormData,
                                                    config: {
                                                        ...eventFormData.config,
                                                        coordEmailEurope: e.target.value
                                                    }
                                                });
                                            }}
                                            placeholder="europe-coordinator@example.com"
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                            Email address for Europe coordinator
                                        </Form.Text>
                                    </Form.Group>
                                </Col>
                            </Row>
                        </div>

                        {/* Config Section (collapsed by default) */}
                        <Accordion className="mb-3">
                            <Accordion.Item eventKey="0">
                                <Accordion.Header>Advanced Configuration (JSON)</Accordion.Header>
                                <Accordion.Body>
                                    <Form.Group>
                                        <Form.Label>Config Object (JSON)</Form.Label>
                                        <Form.Control
                                            ref={jsonTextareaRef}
                                            as="textarea"
                                            rows={10}
                                            value={JSON.stringify(eventFormData.config, null, 2)}
                                            onChange={(e) => {
                                                try {
                                                    const parsed = JSON.parse(e.target.value);
                                                    setEventFormData({ ...eventFormData, config: parsed });
                                                } catch (err) {
                                                    // Invalid JSON, don't update
                                                }
                                            }}
                                            style={{
                                                fontFamily: 'monospace',
                                                backgroundColor: '#2b2b2b',
                                                color: 'white',
                                                border: '1px solid #555'
                                            }}
                                        />
                                    </Form.Group>
                                </Accordion.Body>
                            </Accordion.Item>
                        </Accordion>

                        {/* SubEvents Section - Only show for non-list events */}
                        {!eventFormData.list && (
                            <div className="card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h5 style={{ color: '#ffc107', margin: 0 }}>SubEvents</h5>
                                    <Button variant="outline-warning" size="sm" onClick={handleAddSubEvent}>
                                        + Add SubEvent
                                    </Button>
                                </div>
                                {eventFormData.subEvents && Object.keys(eventFormData.subEvents).length > 0 ? (
                                    Object.entries(eventFormData.subEvents).map(([key, subEvent]) => (
                                        <div key={key} className="subevent-item">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <strong style={{ color: '#ffc107' }}>{key}</strong>
                                                    <div style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.25rem' }}>
                                                        {subEvent.date && `Date: ${subEvent.date}`}
                                                        {subEvent.eventComplete && ' • Complete'}
                                                        {subEvent.eventOnDeck && ' • On Deck'}
                                                    </div>
                                                </div>
                                                <div>
                                                    <Button
                                                        variant="outline-warning"
                                                        size="sm"
                                                        className="me-2"
                                                        onClick={() => handleEditSubEvent(key, subEvent)}
                                                    >
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        variant="outline-danger"
                                                        size="sm"
                                                        onClick={() => handleDeleteSubEvent(key)}
                                                    >
                                                        Delete
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                        No subevents defined
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Read-only fields note */}
                        <div style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '1rem' }}>
                            <strong>Note:</strong> Fields like embeddedEmails and embeddedVideoList are read-only and managed by other applications.
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowEventModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveEvent}>
                        Save Event
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Pool Edit Modal */}
            <Modal show={showPoolModal} onHide={() => setShowPoolModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>{isNewPool ? 'Create New Pool' : `Edit Pool: ${poolFormData.name}`}</span>
                        {!isNewPool && (
                            <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => setShowDeletePoolConfirm(true)}
                                style={{ marginLeft: 'auto' }}
                            >
                                🗑️ Delete
                            </Button>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>Pool Code (name)*</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={poolFormData.name}
                                    onChange={(e) => setPoolFormData({ ...poolFormData, name: e.target.value })}
                                    disabled={!isNewPool}
                                    placeholder="e.g., refuge-or-oath"
                                />
                                <Form.Text className="text-muted">
                                    This is the pool identifier used in event configurations
                                </Form.Text>
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Description</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={2}
                                    value={poolFormData.description || ''}
                                    onChange={(e) => setPoolFormData({ ...poolFormData, description: e.target.value })}
                                    placeholder="Describe this eligibility pool..."
                                />
                            </Form.Group>
                        </div>

                        <div className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h5 style={{ color: '#ffc107', margin: 0 }}>Attributes</h5>
                                <Button variant="outline-warning" size="sm" onClick={handleAddPoolAttribute}>
                                    + Add Attribute
                                </Button>
                            </div>
                            {poolFormData.attributes && poolFormData.attributes.length > 0 ? (
                                poolFormData.attributes.map((attr, index) => {
                                    const type = attr.type || 'pool';

                                    const handleStringArrayChange = (field: keyof PoolAttribute, value: string) => {
                                        const parts = value
                                            .split(',')
                                            .map(p => p.trim())
                                            .filter(p => p.length > 0);
                                        handleUpdatePoolAttribute(index, field as string, parts);
                                    };

                                    const poolsValue = Array.isArray(attr.pools) ? attr.pools.join(', ') : '';

                                    const typeHelpText = (() => {
                                        switch (type) {
                                            case 'true':
                                                return 'Always eligible when this attribute is evaluated. This is a pass-through condition that makes any student eligible regardless of other criteria.';
                                            case 'pool':
                                                return 'Uses the eligibility result of another pool by name. Recursively checks if the student is eligible for the referenced pool. The referenced pool must exist in the pools data.';
                                            case 'pooldiff':
                                                return 'Eligible if in one pool but NOT in another (set difference: inpool minus outpool). Requires both inpool and outpool parameters. Student must be eligible for inpool AND NOT eligible for outpool.';
                                            case 'pooland':
                                                return 'Eligible only if the student is in BOTH referenced pools (set intersection). Requires both pool1 and pool2 parameters. Student must be eligible for pool1 AND pool2 simultaneously.';
                                            case 'practice':
                                                return 'Checks a boolean field on the student\'s practice record. The field parameter specifies the key to check (e.g., "currentPractice"). Returns true if student.practice[field] is truthy.';
                                            case 'offering':
                                                return 'Checks whether the student has an offering in a specific program (aid) and subevent. If subevent is "any", checks if student has ANY offering in any subevent for the program. Otherwise, checks the specific subevent\'s offeringSKU.';
                                            case 'currenteventoffering':
                                                return 'Checks offering history for the CURRENT event (aid is automatically the current event context) and a given subevent. Also requires that the student is NOT withdrawn. Returns true if offeringSKU exists for the subevent and student.programs[currentAid].withdrawn is false.';
                                            case 'currenteventtest':
                                                return 'Checks the test flag for the CURRENT event. Returns true if student.programs[currentAid].test is truthy. No additional parameters required.';
                                            case 'currenteventnotoffering':
                                                return 'Eligible only if there is NO offering for the CURRENT event subevent. Returns true when student.programs[currentAid].offeringHistory[subevent] does NOT have an offeringSKU. The inverse of currenteventoffering.';
                                            case 'offeringandpools':
                                                return 'Requires both an offering (aid + subevent) AND membership in at least one of the listed pools. First checks if student has an offering for the specified program and subevent, then checks if student is eligible for at least one pool in the pools array. Both conditions must be true.';
                                            case 'oath':
                                                return 'Checks whether the student has taken an oath in the given program (aid). Returns true if student.programs[aid].oath is truthy.';
                                            case 'attended':
                                                return 'Checks whether the student has attended the given program (aid). Returns true if student.programs[aid].attended is truthy.';
                                            case 'join':
                                                return 'Checks whether the student has joined the given program (aid). Returns true if student.programs[aid].join is truthy.';
                                            case 'currenteventjoin':
                                                return 'Checks whether the student has joined the CURRENT event. Returns true if student.programs[currentAid].join is truthy. No additional parameters required.';
                                            case 'currenteventmanualinclude':
                                                return 'Checks whether the student has been manually included for the CURRENT event. Returns true if student.programs[currentAid].manualInclude is truthy. This is typically set by administrators.';
                                            case 'currenteventaccepted':
                                                return 'Checks whether the student is accepted (and not withdrawn) for the CURRENT event. Returns true if student.programs[currentAid].accepted is truthy AND student.programs[currentAid].withdrawn is false. Both conditions must be met.';
                                            case 'currenteventnotjoin':
                                                return 'Eligible only if the student has NOT joined the CURRENT event. Returns true when student.programs[currentAid].join is falsy. The inverse of currenteventjoin.';
                                            case 'joinwhich':
                                                return 'Checks whichRetreats for a given program (aid) and retreat key prefix. Requires: student has joined (join is true), student is not withdrawn, and at least one key in student.programs[aid].whichRetreats starts with the retreat prefix and has a truthy value. Used for retreat-specific eligibility.';
                                            case 'offeringwhich':
                                                return 'Requires both whichRetreats and offeringHistory to match retreat and subevent patterns for a given program (aid). First checks: student has joined, not withdrawn, and whichRetreats has a key starting with retreat prefix. Then checks: offeringHistory has a key starting with subevent prefix and has an offeringSKU. Both conditions must be true. Used for complex retreat + offering combinations.';
                                            case 'eligible':
                                                return 'Checks the generic eligible flag for the CURRENT event. Returns true if student.programs[currentAid].eligible is truthy. This is a general-purpose eligibility flag that can be set by various processes.';
                                            default:
                                                return '';
                                        }
                                    })();

                                    return (
                                        <div key={index} className="subevent-item mb-3">
                                            <Row>
                                                <Col md={4}>
                                                    <Form.Group>
                                                        <Form.Label>Type</Form.Label>
                                                        <Form.Select
                                                            value={type}
                                                            onChange={(e) => handleUpdatePoolAttribute(index, 'type', e.target.value)}
                                                        >
                                                            <option value="true">true – always eligible</option>
                                                            <option value="pool">pool – reference another pool</option>
                                                            <option value="pooldiff">pooldiff – in one pool but not another</option>
                                                            <option value="pooland">pooland – in both pools</option>
                                                            <option value="practice">practice – practice field</option>
                                                            <option value="offering">offering – program + subevent</option>
                                                            <option value="currenteventoffering">currenteventoffering – current event + subevent</option>
                                                            <option value="currenteventtest">currenteventtest – current event test flag</option>
                                                            <option value="currenteventnotoffering">currenteventnotoffering – no current event offering</option>
                                                            <option value="offeringandpools">offeringandpools – offering + pools</option>
                                                            <option value="oath">oath – program oath</option>
                                                            <option value="attended">attended – program attendance</option>
                                                            <option value="join">join – program join</option>
                                                            <option value="currenteventjoin">currenteventjoin – join current event</option>
                                                            <option value="currenteventmanualinclude">currenteventmanualinclude – manual include</option>
                                                            <option value="currenteventaccepted">currenteventaccepted – accepted (not withdrawn)</option>
                                                            <option value="currenteventnotjoin">currenteventnotjoin – not joined current event</option>
                                                            <option value="joinwhich">joinwhich – joined + whichRetreats</option>
                                                            <option value="offeringwhich">offeringwhich – offering + whichRetreats</option>
                                                            <option value="eligible">eligible – current event eligible flag</option>
                                                        </Form.Select>
                                                        {typeHelpText && (
                                                            <Form.Text className="text-muted">
                                                                {typeHelpText}
                                                            </Form.Text>
                                                        )}
                                                    </Form.Group>
                                                </Col>
                                                <Col md={6}>
                                                    {type === 'pool' && (
                                                        <Form.Group className="mb-2">
                                                            <PoolNameAutocomplete
                                                                value={attr.name || ''}
                                                                onChange={(value) => handleUpdatePoolAttribute(index, 'name', value)}
                                                                placeholder="Name of another eligibility pool (must exist in pools data)"
                                                                label="Pool Name (name)"
                                                                id={`pool-name-${index}`}
                                                                excludePoolName={poolFormData.name}
                                                            />
                                                        </Form.Group>
                                                    )}
                                                    {type === 'pooldiff' && (
                                                        <>
                                                            <Form.Group className="mb-2">
                                                                <PoolNameAutocomplete
                                                                    value={attr.inpool || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'inpool', value)}
                                                                    placeholder="Pool the student must be IN"
                                                                    label="In Pool (inpool)"
                                                                    id={`pooldiff-inpool-${index}`}
                                                                    excludePoolName={poolFormData.name}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <PoolNameAutocomplete
                                                                    value={attr.outpool || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'outpool', value)}
                                                                    placeholder="Pool the student must NOT be in"
                                                                    label="Out Pool (outpool)"
                                                                    id={`pooldiff-outpool-${index}`}
                                                                    excludePoolName={poolFormData.name}
                                                                />
                                                            </Form.Group>
                                                        </>
                                                    )}
                                                    {type === 'pooland' && (
                                                        <>
                                                            <Form.Group className="mb-2">
                                                                <PoolNameAutocomplete
                                                                    value={attr.pool1 || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'pool1', value)}
                                                                    placeholder="First pool name"
                                                                    label="First Pool (pool1)"
                                                                    id={`pooland-pool1-${index}`}
                                                                    excludePoolName={poolFormData.name}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <PoolNameAutocomplete
                                                                    value={attr.pool2 || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'pool2', value)}
                                                                    placeholder="Second pool name"
                                                                    label="Second Pool (pool2)"
                                                                    id={`pooland-pool2-${index}`}
                                                                    excludePoolName={poolFormData.name}
                                                                />
                                                            </Form.Group>
                                                        </>
                                                    )}
                                                    {type === 'practice' && (
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Practice Field (field)</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={attr.field || ''}
                                                                onChange={(e) => handleUpdatePoolAttribute(index, 'field', e.target.value)}
                                                                placeholder="Key on student.practice object (e.g., currentPractice, vipassana, etc.)"
                                                            />
                                                        </Form.Group>
                                                    )}
                                                    {type === 'offering' && (
                                                        <>
                                                            <Form.Group className="mb-2">
                                                                <EventCodeAutocomplete
                                                                    value={attr.aid || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'aid', value)}
                                                                    placeholder="Program / event code (aid) - checks programs[aid].offeringHistory"
                                                                    label="Program AID (aid)"
                                                                    id={`offering-aid-${index}`}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <SubeventAutocomplete
                                                                    value={attr.subevent || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'subevent', value)}
                                                                    placeholder="Subevent key (e.g., 'retreat-2024') or 'any' for any subevent"
                                                                    label="Subevent (subevent)"
                                                                    id={`offering-subevent-${index}`}
                                                                    eventAid={attr.aid}
                                                                />
                                                            </Form.Group>
                                                        </>
                                                    )}
                                                    {type === 'currenteventoffering' && (
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Subevent (subevent) - Current Event</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={attr.subevent || ''}
                                                                onChange={(e) => handleUpdatePoolAttribute(index, 'subevent', e.target.value)}
                                                                placeholder="Subevent key for current event (aid is auto-set to current event context)"
                                                            />
                                                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                                Also requires student is not withdrawn
                                                            </Form.Text>
                                                        </Form.Group>
                                                    )}
                                                    {type === 'currenteventnotoffering' && (
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Subevent (subevent) - Current Event</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={attr.subevent || ''}
                                                                onChange={(e) => handleUpdatePoolAttribute(index, 'subevent', e.target.value)}
                                                                placeholder="Subevent key for current event (returns true if NO offeringSKU exists)"
                                                            />
                                                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                                Inverse of currenteventoffering - eligible when offering does NOT exist
                                                            </Form.Text>
                                                        </Form.Group>
                                                    )}
                                                    {type === 'offeringandpools' && (
                                                        <>
                                                            <Form.Group className="mb-2">
                                                                <EventCodeAutocomplete
                                                                    value={attr.aid || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'aid', value)}
                                                                    placeholder="Program / event code (aid) - must have offering"
                                                                    label="Program AID (aid)"
                                                                    id={`offeringandpools-aid-${index}`}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <SubeventAutocomplete
                                                                    value={attr.subevent || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'subevent', value)}
                                                                    placeholder="Subevent key - must have offeringSKU"
                                                                    label="Subevent (subevent)"
                                                                    id={`offeringandpools-subevent-${index}`}
                                                                    eventAid={attr.aid}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <PoolNamesAutocomplete
                                                                    value={poolsValue}
                                                                    onChange={(value) => handleStringArrayChange('pools', value)}
                                                                    placeholder="pool-a, pool-b, pool-c (student must be in at least one)"
                                                                    label="Pools (pools) - comma-separated"
                                                                    id={`offeringandpools-pools-${index}`}
                                                                />
                                                            </Form.Group>
                                                        </>
                                                    )}
                                                    {(type === 'oath' ||
                                                        type === 'attended' ||
                                                        type === 'join') && (
                                                            <Form.Group className="mb-2">
                                                                <EventCodeAutocomplete
                                                                    value={attr.aid || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'aid', value)}
                                                                    placeholder={`Program / event code (aid) - checks programs[aid].${type}`}
                                                                    label="Program AID (aid)"
                                                                    id={`${type}-aid-${index}`}
                                                                />
                                                            </Form.Group>
                                                        )}
                                                    {(type === 'joinwhich' || type === 'offeringwhich') && (
                                                        <>
                                                            <Form.Group className="mb-2">
                                                                <EventCodeAutocomplete
                                                                    value={attr.aid || ''}
                                                                    onChange={(value) => handleUpdatePoolAttribute(index, 'aid', value)}
                                                                    placeholder="Program / event code (aid) - must have join=true and not withdrawn"
                                                                    label="Program AID (aid)"
                                                                    id={`${type}-aid-${index}`}
                                                                />
                                                            </Form.Group>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label>Retreat Key Prefix (retreat)</Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={attr.retreat || ''}
                                                                    onChange={(e) => handleUpdatePoolAttribute(index, 'retreat', e.target.value)}
                                                                    placeholder="Prefix for whichRetreats keys (e.g., 'retreat-2024' matches 'retreat-2024-spring')"
                                                                />
                                                            </Form.Group>
                                                            {type === 'offeringwhich' && (
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Subevent Key Prefix (subevent)</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={attr.subevent || ''}
                                                                        onChange={(e) => handleUpdatePoolAttribute(index, 'subevent', e.target.value)}
                                                                        placeholder="Prefix for offeringHistory keys (e.g., 'retreat' matches 'retreat-2024')"
                                                                    />
                                                                </Form.Group>
                                                            )}
                                                        </>
                                                    )}
                                                    {(type === 'currenteventtest' ||
                                                        type === 'currenteventjoin' ||
                                                        type === 'currenteventmanualinclude' ||
                                                        type === 'currenteventaccepted' ||
                                                        type === 'currenteventnotjoin' ||
                                                        type === 'eligible' ||
                                                        type === 'true') && (
                                                            <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: '0.5rem' }}>
                                                                {type === 'currenteventaccepted' && 'No parameters. Checks programs[currentAid].accepted AND not withdrawn.'}
                                                                {type === 'currenteventtest' && 'No parameters. Checks programs[currentAid].test flag.'}
                                                                {type === 'currenteventjoin' && 'No parameters. Checks programs[currentAid].join flag.'}
                                                                {type === 'currenteventmanualinclude' && 'No parameters. Checks programs[currentAid].manualInclude flag.'}
                                                                {type === 'currenteventnotjoin' && 'No parameters. Returns true if programs[currentAid].join is falsy.'}
                                                                {type === 'eligible' && 'No parameters. Checks programs[currentAid].eligible flag.'}
                                                                {type === 'true' && 'No parameters. Always returns true (pass-through condition).'}
                                                            </div>
                                                        )}
                                                </Col>
                                                <Col md={2} style={{ display: 'flex', alignItems: 'end' }}>
                                                    <Button
                                                        variant="outline-danger"
                                                        size="sm"
                                                        onClick={() => handleDeletePoolAttribute(index)}
                                                        style={{ marginBottom: '1rem' }}
                                                    >
                                                        Delete
                                                    </Button>
                                                </Col>
                                            </Row>
                                        </div>
                                    );
                                })
                            ) : (
                                <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                    No attributes defined
                                </div>
                            )}
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowPoolModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSavePool}>
                        Save Pool
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* SubEvent Edit Modal */}
            <Modal show={showSubEventModal} onHide={() => setShowSubEventModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>
                        {isNewSubEvent ? 'Add SubEvent' : `Edit SubEvent: ${selectedSubEventKey}`}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Date</Form.Label>
                                    <Form.Control
                                        type="date"
                                        value={subEventFormData.date || ''}
                                        onChange={(e) => setSubEventFormData({ ...subEventFormData, date: e.target.value })}
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>RCP Level</Form.Label>
                                    <Form.Control
                                        type="number"
                                        value={subEventFormData.rcpLevel || ''}
                                        onChange={(e) => setSubEventFormData({ ...subEventFormData, rcpLevel: parseInt(e.target.value) || undefined })}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Offering Mode</Form.Label>
                                    <Form.Select
                                        value={subEventFormData.offeringMode || ''}
                                        onChange={(e) => setSubEventFormData({ ...subEventFormData, offeringMode: e.target.value })}
                                    >
                                        <option value="">Select an offering...</option>
                                        {allOfferings.map(offering => (
                                            <option key={offering.oid} value={offering.oid}>
                                                {offering.oid}
                                            </option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Time String</Form.Label>
                                    <Form.Control
                                        as="textarea"
                                        rows={2}
                                        value={subEventFormData.timeString || ''}
                                        onChange={(e) => setSubEventFormData({ ...subEventFormData, timeString: e.target.value })}
                                        placeholder="Event time information"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Zoom Link</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={subEventFormData.zoomLink || ''}
                                        onChange={(e) => setSubEventFormData({ ...subEventFormData, zoomLink: e.target.value })}
                                        placeholder="https://zoom.us/..."
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        {/* Vimeo Showcase Management */}
                        <div className="card" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h5 style={{ color: '#ffc107', margin: 0 }}>Vimeo Showcases</h5>
                                <Button variant="outline-warning" size="sm" onClick={handleAddShowcase}>
                                    + Add Showcase
                                </Button>
                            </div>
                            <Form.Check
                                type="checkbox"
                                label={<span style={{ color: 'white' }}>Per-Language Showcases (one showcase per language)</span>}
                                checked={perLanguageShowcases}
                                onChange={(e) => setPerLanguageShowcases(e.target.checked)}
                                style={{ marginBottom: '1rem' }}
                            />
                            <Form.Text className="text-muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '1rem' }}>
                                {perLanguageShowcases
                                    ? 'Each showcase contains all videos for one language. Videos will be indexed by position in showcase.'
                                    : 'Each showcase contains multiple languages for one day of teaching. Videos will be grouped by language.'}
                            </Form.Text>
                            {subEventFormData.embeddedShowcaseList && subEventFormData.embeddedShowcaseList.length > 0 ? (
                                subEventFormData.embeddedShowcaseList.map((showcaseId, index) => (
                                    <div key={index} style={{
                                        display: 'flex',
                                        gap: '0.5rem',
                                        alignItems: 'center',
                                        marginBottom: '0.5rem',
                                        padding: '0.5rem',
                                        backgroundColor: '#2b2b2b',
                                        borderRadius: '4px'
                                    }}>
                                        <Form.Control
                                            type="text"
                                            value={showcaseId}
                                            onChange={(e) => handleUpdateShowcase(index, e.target.value)}
                                            placeholder="Enter Vimeo showcase ID"
                                            style={{ flex: 1 }}
                                        />
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => handleProcessShowcase(index)}
                                            disabled={processingShowcaseIndex === index || !showcaseId.trim()}
                                        >
                                            {processingShowcaseIndex === index ? (
                                                <>
                                                    <Spinner animation="border" size="sm" className="me-2" />
                                                    Processing...
                                                </>
                                            ) : (
                                                'Process'
                                            )}
                                        </Button>
                                        <Button
                                            variant="outline-danger"
                                            size="sm"
                                            onClick={() => handleDeleteShowcase(index)}
                                            disabled={subEventFormData.embeddedShowcaseList!.length === 1}
                                        >
                                            ×
                                        </Button>
                                    </div>
                                ))
                            ) : (
                                <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                    No showcases defined. Click "+ Add Showcase" to add one.
                                </div>
                            )}
                            {subEventFormData.embeddedVideoList && subEventFormData.embeddedVideoList.length > 0 && (
                                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
                                    <div style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '0.5rem' }}>
                                        Processed Videos ({subEventFormData.embeddedVideoList.length} entries):
                                    </div>
                                    {subEventFormData.embeddedVideoList.map((videoEntry, index) => (
                                        <div key={index} style={{ fontSize: '0.85rem', color: '#888', marginBottom: '0.25rem' }}>
                                            Entry {index}: {Object.keys(videoEntry).length} language(s)
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <Row>
                            <Col md={3}>
                                <Form.Check
                                    type="checkbox"
                                    label={<span style={{ color: 'white' }}>Event Complete</span>}
                                    checked={subEventFormData.eventComplete || false}
                                    onChange={(e) => setSubEventFormData({ ...subEventFormData, eventComplete: e.target.checked })}
                                />
                            </Col>
                            <Col md={3}>
                                <Form.Check
                                    type="checkbox"
                                    label={<span style={{ color: 'white' }}>Event On Deck</span>}
                                    checked={subEventFormData.eventOnDeck || false}
                                    onChange={(e) => setSubEventFormData({ ...subEventFormData, eventOnDeck: e.target.checked })}
                                />
                            </Col>
                            <Col md={3}>
                                <Form.Check
                                    type="checkbox"
                                    label={<span style={{ color: 'white' }}>Reg Link Available</span>}
                                    checked={subEventFormData.regLinkAvailable || false}
                                    onChange={(e) => setSubEventFormData({ ...subEventFormData, regLinkAvailable: e.target.checked })}
                                />
                            </Col>
                            <Col md={3}>
                                <Form.Check
                                    type="checkbox"
                                    label={<span style={{ color: 'white' }}>Media Notify</span>}
                                    checked={subEventFormData.mediaNotify || false}
                                    onChange={(e) => setSubEventFormData({ ...subEventFormData, mediaNotify: e.target.checked })}
                                />
                            </Col>
                        </Row>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowSubEventModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveSubEvent}>
                        {isNewSubEvent ? 'Add' : 'Update'} SubEvent
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Delete Event Confirmation Modal */}
            <Modal show={showDeleteEventConfirm} onHide={() => setShowDeleteEventConfirm(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Confirm Delete Event</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the event:</p>
                    <p style={{ color: '#ffc107', fontWeight: 'bold', fontSize: '1.1rem', marginTop: '1rem' }}>
                        {selectedEvent?.name} ({selectedEvent?.aid})?
                    </p>
                    <p style={{ color: '#f87171', marginTop: '1rem' }}>
                        This action cannot be undone.
                    </p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowDeleteEventConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteEvent}>
                        Delete Event
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Delete Pool Confirmation Modal */}
            <Modal show={showDeletePoolConfirm} onHide={() => setShowDeletePoolConfirm(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Confirm Delete Pool</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the pool:</p>
                    <p style={{ color: '#ffc107', fontWeight: 'bold', fontSize: '1.1rem', marginTop: '1rem' }}>
                        {selectedPool?.name}
                        {selectedPool?.description && ` - ${selectedPool.description}`}?
                    </p>
                    <p style={{ color: '#f87171', marginTop: '1rem' }}>
                        This action cannot be undone. Events using this pool may be affected.
                    </p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowDeletePoolConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeletePool}>
                        Delete Pool
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Script Edit Modal */}
            <Modal show={showScriptModal} onHide={() => setShowScriptModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>{isNewScript ? 'Create New Script' : `Edit Script: ${scriptFormData.name}`}</span>
                        {!isNewScript && (
                            <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => setShowDeleteScriptConfirm(true)}
                                style={{ marginLeft: 'auto' }}
                            >
                                🗑️ Delete
                            </Button>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>Script Name*</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={scriptFormData.name}
                                    onChange={(e) => setScriptFormData({ ...scriptFormData, name: e.target.value })}
                                    disabled={!isNewScript}
                                    placeholder="e.g., path, SWInPerson"
                                />
                                <Form.Text className="text-muted">
                                    The unique identifier for this script
                                </Form.Text>
                            </Form.Group>
                        </div>

                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Script Steps</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>Select Steps (in order)</Form.Label>
                                <div style={{
                                    border: '1px solid #555',
                                    borderRadius: '4px',
                                    padding: '10px',
                                    backgroundColor: '#2b2b2b',
                                    maxHeight: '400px',
                                    overflowY: 'auto'
                                }}>
                                    {(() => {
                                        const selectedSteps = scriptFormData.steps || [];
                                        const unselectedSteps = AVAILABLE_SCRIPT_STEPS.filter(step => !selectedSteps.includes(step));
                                        const allStepsToDisplay = [...selectedSteps, ...unselectedSteps];

                                        return allStepsToDisplay.map(step => {
                                            const isSelected = scriptFormData.steps?.includes(step);
                                            const stepIndex = scriptFormData.steps?.indexOf(step);

                                            return (
                                                <div key={step} style={{
                                                    marginBottom: '8px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px'
                                                }}>
                                                    <Form.Check
                                                        type="checkbox"
                                                        id={`step-${step}`}
                                                        label={
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                {isSelected && (
                                                                    <Badge bg="warning" style={{ minWidth: '30px' }}>
                                                                        {(stepIndex ?? -1) + 1}
                                                                    </Badge>
                                                                )}
                                                                <span style={{ color: 'white' }}>{step}</span>
                                                            </span>
                                                        }
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setScriptFormData({
                                                                    ...scriptFormData,
                                                                    steps: [...(scriptFormData.steps || []), step]
                                                                });
                                                            } else {
                                                                setScriptFormData({
                                                                    ...scriptFormData,
                                                                    steps: (scriptFormData.steps || []).filter(s => s !== step)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    {isSelected && stepIndex !== undefined && stepIndex > 0 && (
                                                        <Button
                                                            variant="outline-secondary"
                                                            size="sm"
                                                            onClick={() => {
                                                                const newSteps = [...scriptFormData.steps];
                                                                const currentIndex = newSteps.indexOf(step);
                                                                if (currentIndex > 0) {
                                                                    [newSteps[currentIndex - 1], newSteps[currentIndex]] =
                                                                        [newSteps[currentIndex], newSteps[currentIndex - 1]];
                                                                    setScriptFormData({ ...scriptFormData, steps: newSteps });
                                                                }
                                                            }}
                                                            style={{ padding: '2px 8px' }}
                                                        >
                                                            ↑
                                                        </Button>
                                                    )}
                                                    {isSelected && stepIndex !== undefined && stepIndex < scriptFormData.steps.length - 1 && (
                                                        <Button
                                                            variant="outline-secondary"
                                                            size="sm"
                                                            onClick={() => {
                                                                const newSteps = [...scriptFormData.steps];
                                                                const currentIndex = newSteps.indexOf(step);
                                                                if (currentIndex < newSteps.length - 1) {
                                                                    [newSteps[currentIndex], newSteps[currentIndex + 1]] =
                                                                        [newSteps[currentIndex + 1], newSteps[currentIndex]];
                                                                    setScriptFormData({ ...scriptFormData, steps: newSteps });
                                                                }
                                                            }}
                                                            style={{ padding: '2px 8px' }}
                                                        >
                                                            ↓
                                                        </Button>
                                                    )}
                                                </div>
                                            );
                                        })
                                    })()}
                                </div>
                                <Form.Text className="text-muted">
                                    Steps are executed in the order shown. Use ↑↓ buttons to reorder selected steps.
                                </Form.Text>
                            </Form.Group>
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowScriptModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveScript}>
                        Save Script
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Delete Script Confirmation Modal */}
            <Modal show={showDeleteScriptConfirm} onHide={() => setShowDeleteScriptConfirm(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Confirm Delete Script</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the script:</p>
                    <p style={{ color: '#ffc107', fontWeight: 'bold', fontSize: '1.1rem', marginTop: '1rem' }}>
                        {selectedScript?.name}?
                    </p>
                    <p style={{ color: '#f87171', marginTop: '1rem' }}>
                        This action cannot be undone. Events using this script may be affected.
                    </p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowDeleteScriptConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteScript}>
                        Delete Script
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Offering Edit Modal */}
            <Modal show={showOfferingModal} onHide={() => setShowOfferingModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>{isNewOffering ? 'Create New Offering' : `Edit Offering: ${offeringFormData.oid}`}</span>
                        {!isNewOffering && (
                            <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => setShowDeleteOfferingConfirm(true)}
                                style={{ marginLeft: 'auto' }}
                            >
                                🗑️ Delete
                            </Button>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>Offering ID (oid)*</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={offeringFormData.oid}
                                    onChange={(e) => setOfferingFormData({ ...offeringFormData, oid: e.target.value })}
                                    disabled={!isNewOffering}
                                    placeholder="e.g., OFFERING-4x-108-gnd-east"
                                    style={{
                                        backgroundColor: '#2b2b2b',
                                        color: !isNewOffering ? '#aaa' : 'white',
                                        border: '1px solid #555',
                                        cursor: !isNewOffering ? 'not-allowed' : 'text'
                                    }}
                                />
                                <Form.Text className="text-muted">
                                    Unique identifier for this offering configuration
                                </Form.Text>
                            </Form.Group>
                        </div>

                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Amounts (5 levels)</h5>
                            <Row>
                                {[0, 1, 2, 3, 4].map(index => (
                                    <Col md={4} key={`amount-${index}`} className="mb-3">
                                        <Form.Group>
                                            <Form.Label>Level {index + 1}</Form.Label>
                                            <Form.Control
                                                type="number"
                                                value={offeringFormData.amounts[index] || 0}
                                                onChange={(e) => {
                                                    const newAmounts = [...offeringFormData.amounts];
                                                    newAmounts[index] = parseFloat(e.target.value) || 0;
                                                    setOfferingFormData({ ...offeringFormData, amounts: newAmounts });
                                                }}
                                                style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                            />
                                        </Form.Group>
                                    </Col>
                                ))}
                            </Row>
                        </div>

                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Fees (5 levels)</h5>
                            <Row>
                                {[0, 1, 2, 3, 4].map(index => (
                                    <Col md={4} key={`fee-${index}`} className="mb-3">
                                        <Form.Group>
                                            <Form.Label>Level {index + 1}</Form.Label>
                                            <Form.Control
                                                type="number"
                                                value={offeringFormData.fees[index] || 0}
                                                onChange={(e) => {
                                                    const newFees = [...offeringFormData.fees];
                                                    newFees[index] = parseFloat(e.target.value) || 0;
                                                    setOfferingFormData({ ...offeringFormData, fees: newFees });
                                                }}
                                                style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                            />
                                        </Form.Group>
                                    </Col>
                                ))}
                            </Row>
                        </div>

                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Prompts</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>Prompt Keys (comma-separated)</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={offeringFormData.prompts?.join(', ') || ''}
                                    onChange={(e) => {
                                        const prompts = e.target.value
                                            .split(',')
                                            .map(p => p.trim())
                                            .filter(p => p.length > 0);
                                        setOfferingFormData({ ...offeringFormData, prompts });
                                    }}
                                    placeholder="e.g., offeringSponsoringX, offeringSuggestedX, offeringAssistedX"
                                    style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                />
                                <Form.Text className="text-muted">
                                    Enter prompt keys separated by commas
                                </Form.Text>
                            </Form.Group>
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowOfferingModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveOffering}>
                        Save Offering
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Delete Offering Confirmation Modal */}
            <Modal show={showDeleteOfferingConfirm} onHide={() => setShowDeleteOfferingConfirm(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Confirm Delete Offering</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the offering:</p>
                    <p style={{ color: '#ffc107', fontWeight: 'bold', fontSize: '1.1rem', marginTop: '1rem' }}>
                        {selectedOffering?.oid}?
                    </p>
                    <p style={{ color: '#f87171', marginTop: '1rem' }}>
                        This action cannot be undone. SubEvents using this offering may be affected.
                    </p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowDeleteOfferingConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteOffering}>
                        Delete Offering
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* View Edit Modal */}
            <Modal show={showViewsModal} onHide={() => setShowViewsModal(false)} size="xl">
                <Modal.Header closeButton>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>{isNewView ? 'Create New View' : `Edit View: ${viewFormData.name}`}</span>
                        {!isNewView && (
                            <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => setShowDeleteViewConfirm(true)}
                                style={{ marginLeft: 'auto' }}
                            >
                                🗑️ Delete
                            </Button>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                            <Form.Group className="mb-3">
                                <Form.Label>View Name*</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={viewFormData.name}
                                    onChange={(e) => setViewFormData({ ...viewFormData, name: e.target.value })}
                                    disabled={!isNewView}
                                    placeholder="e.g., joined-vermont"
                                    style={{
                                        backgroundColor: '#2b2b2b',
                                        color: !isNewView ? '#aaa' : 'white',
                                        border: '1px solid #555',
                                        cursor: !isNewView ? 'not-allowed' : 'text'
                                    }}
                                />
                            </Form.Group>
                        </div>

                        <div className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h5 style={{ color: '#ffc107', margin: 0 }}>Column Definitions</h5>
                                <Button variant="outline-warning" size="sm" onClick={handleAddColumnDef}>
                                    + Add Column
                                </Button>
                            </div>
                            {viewFormData.columnDefs && viewFormData.columnDefs.length > 0 ? (
                                viewFormData.columnDefs.map((colDef, index) => {
                                    const colName = colDef.name || ''
                                    const isPredefined = ['rowIndex', 'name', 'email', 'accepted', 'withdrawn', 'installmentsTotal', 'installmentsReceived', 'installmentsDue', 'installmentsLF', 'spokenLanguage'].includes(colName)

                                    return (
                                        <div key={index} className="subevent-item mb-3">
                                            <Row>
                                                <Col md={12}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Column Name*</Form.Label>
                                                        <Form.Control
                                                            type="text"
                                                            list={`col-name-${index}`}
                                                            value={colName}
                                                            onChange={(e) => handleUpdateColumnDef(index, 'name', e.target.value)}
                                                            placeholder="e.g., rowIndex, poolMember-xyz"
                                                        />
                                                        <datalist id={`col-name-${index}`}>
                                                            <option value="rowIndex" />
                                                            <option value="name" />
                                                            <option value="email" />
                                                            <option value="accepted" />
                                                            <option value="withdrawn" />
                                                            <option value="installmentsTotal" />
                                                            <option value="installmentsReceived" />
                                                            <option value="installmentsDue" />
                                                            <option value="installmentsLF" />
                                                            <option value="spokenLanguage" />
                                                            <option value="poolMember-xyz" />
                                                            <option value="currentAIDBool-xyz" />
                                                            <option value="specifiedAIDBool-xyz" />
                                                            <option value="currentAIDMapBool-xyz" />
                                                            <option value="specifiedAIDMapBool-xyz" />
                                                            <option value="currentAIDString-xyz" />
                                                            <option value="specifiedAIDString-xyz" />
                                                            <option value="currentAIDNumber-xyz" />
                                                            <option value="specifiedAIDNumber-xyz" />
                                                            <option value="baseBool-xyz" />
                                                            <option value="baseString-xyz" />
                                                            <option value="practiceBool-xyz" />
                                                            <option value="currentAIDMapList-xyz" />
                                                            <option value="offeringCount-xyz" />
                                                        </datalist>
                                                    </Form.Group>
                                                </Col>
                                            </Row>
                                            {!isPredefined && (
                                                <>
                                                    <Row>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label>Header Name</Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={colDef.headerName || ''}
                                                                    onChange={(e) => handleUpdateColumnDef(index, 'headerName', e.target.value)}
                                                                    placeholder="Display name"
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    {colName.includes('poolMember') && (
                                                        <Row>
                                                            <Col md={6}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Pool Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        list={`pool-${index}`}
                                                                        value={colDef.pool || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'pool', e.target.value)}
                                                                        placeholder="Select pool"
                                                                    />
                                                                    <datalist id={`pool-${index}`}>
                                                                        {allPools.map(pool => (
                                                                            <option key={pool.name} value={pool.name} />
                                                                        ))}
                                                                    </datalist>
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {(colName.includes('currentAIDBool') || colName.includes('baseBool') || colName.includes('practiceBool') || colName.includes('currentAIDMapBool') || colName.includes('specifiedAIDBool') || colName.includes('specifiedAIDMapBool')) && (
                                                        <Row>
                                                            {(colName.includes('specifiedAIDBool') || colName.includes('specifiedAIDMapBool')) && (
                                                                <Col md={colName.includes('specifiedAIDMapBool') ? 4 : 6}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>AID*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={colDef.aid || ''}
                                                                            onChange={(e) => handleUpdateColumnDef(index, 'aid', e.target.value)}
                                                                            placeholder="Event code"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                            )}
                                                            {colName.includes('currentAIDMapBool') && (
                                                                <Col md={6}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Map Name*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={colDef.map || ''}
                                                                            onChange={(e) => handleUpdateColumnDef(index, 'map', e.target.value)}
                                                                            placeholder="e.g., whichRetreats"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                            )}
                                                            {colName.includes('specifiedAIDMapBool') && (
                                                                <Col md={4}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Map Name*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={colDef.map || ''}
                                                                            onChange={(e) => handleUpdateColumnDef(index, 'map', e.target.value)}
                                                                            placeholder="e.g., whichRetreats"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                            )}
                                                            <Col md={colName.includes('currentAIDMapBool') || colName.includes('specifiedAIDMapBool') ? (colName.includes('specifiedAIDMapBool') ? 4 : 6) : (colName.includes('specifiedAIDBool') ? 6 : 12)}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Bool Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={colDef.boolName || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'boolName', e.target.value)}
                                                                        placeholder="e.g., join, accepted"
                                                                    />
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {(colName.includes('currentAIDString') || colName.includes('baseString') || colName.includes('specifiedAIDString')) && (
                                                        <Row>
                                                            {colName.includes('specifiedAIDString') && (
                                                                <Col md={6}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>AID*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={colDef.aid || ''}
                                                                            onChange={(e) => handleUpdateColumnDef(index, 'aid', e.target.value)}
                                                                            placeholder="Event code"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                            )}
                                                            <Col md={colName.includes('specifiedAIDString') ? 6 : 12}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>String Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={colDef.stringName || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'stringName', e.target.value)}
                                                                        placeholder="e.g., submitTime"
                                                                    />
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {(colName.includes('currentAIDNumber') || colName.includes('specifiedAIDNumber')) && (
                                                        <Row>
                                                            {colName.includes('specifiedAIDNumber') && (
                                                                <Col md={6}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>AID*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={colDef.aid || ''}
                                                                            onChange={(e) => handleUpdateColumnDef(index, 'aid', e.target.value)}
                                                                            placeholder="Event code"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                            )}
                                                            <Col md={colName.includes('specifiedAIDNumber') ? 6 : 12}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Number Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={colDef.numberName || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'numberName', e.target.value)}
                                                                        placeholder="e.g., count, total"
                                                                    />
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {colName.includes('offeringCount') && (
                                                        <Row>
                                                            <Col md={6}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>AID*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={colDef.aid || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'aid', e.target.value)}
                                                                        placeholder="Event code"
                                                                    />
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {colName.includes('currentAIDMapList') && (
                                                        <Row>
                                                            <Col md={6}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Map Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        value={colDef.map || ''}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'map', e.target.value)}
                                                                        placeholder="e.g., setup"
                                                                    />
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                </>
                                            )}
                                            <Row className="mt-2">
                                                <Col md={6}>
                                                    <Form.Group>
                                                        <Form.Check
                                                            type="checkbox"
                                                            label={<span style={{ color: 'white' }}>Write Enabled</span>}
                                                            checked={colDef.writeEnabled || false}
                                                            onChange={(e) => handleUpdateColumnDef(index, 'writeEnabled', e.target.checked)}
                                                        />
                                                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                            Allow users to edit values in this column (requires write permission)
                                                        </Form.Text>
                                                    </Form.Group>
                                                </Col>
                                                <Col md={6} className="d-flex justify-content-end align-items-end gap-2">
                                                    <Button
                                                        variant="outline-secondary"
                                                        size="sm"
                                                        onClick={() => handleMoveColumnDefUp(index)}
                                                        disabled={index === 0}
                                                        title="Move up"
                                                    >
                                                        ↑
                                                    </Button>
                                                    <Button
                                                        variant="outline-secondary"
                                                        size="sm"
                                                        onClick={() => handleMoveColumnDefDown(index)}
                                                        disabled={index >= (viewFormData.columnDefs?.length || 0) - 1}
                                                        title="Move down"
                                                    >
                                                        ↓
                                                    </Button>
                                                    <Button
                                                        variant="outline-danger"
                                                        size="sm"
                                                        onClick={() => handleDeleteColumnDef(index)}
                                                    >
                                                        Delete
                                                    </Button>
                                                </Col>
                                            </Row>
                                        </div>
                                    )
                                })
                            ) : (
                                <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                    No column definitions
                                </div>
                            )}
                        </div>

                        <div className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h5 style={{ color: '#ffc107', margin: 0 }}>View Conditions</h5>
                                <Button variant="outline-warning" size="sm" onClick={handleAddViewCondition}>
                                    + Add Condition
                                </Button>
                            </div>
                            {viewFormData.viewConditions && viewFormData.viewConditions.length > 0 ? (
                                viewFormData.viewConditions.map((condition, index) => (
                                    <div key={index} className="subevent-item mb-3">
                                        <Row>
                                            <Col md={4}>
                                                <Form.Group className="mb-2">
                                                    <Form.Label>Condition Type*</Form.Label>
                                                    <Form.Select
                                                        value={condition.name || 'currentAIDBool'}
                                                        onChange={(e) => handleUpdateViewCondition(index, 'name', e.target.value)}
                                                    >
                                                        <option value="currentAIDBool">currentAIDBool</option>
                                                        <option value="currentAIDMapBool">currentAIDMapBool</option>
                                                        <option value="baseBool">baseBool</option>
                                                        <option value="practiceBool">practiceBool</option>
                                                        <option value="poolMember">poolMember</option>
                                                        <option value="offering">offering</option>
                                                        <option value="deposit">deposit</option>
                                                        <option value="spokenLanguage">spokenLanguage</option>
                                                        <option value="writtenLanguage">writtenLanguage</option>
                                                    </Form.Select>
                                                </Form.Group>
                                            </Col>
                                            {(condition.name === 'currentAIDBool' || condition.name === 'baseBool' || condition.name === 'practiceBool') && (
                                                <>
                                                    <Col md={4}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Bool Name*</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={condition.boolName || ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'boolName', e.target.value)}
                                                                placeholder="e.g., join"
                                                            />
                                                        </Form.Group>
                                                    </Col>
                                                    <Col md={4}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Bool Value*</Form.Label>
                                                            <Form.Select
                                                                value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                            >
                                                                <option value="true">true</option>
                                                                <option value="false">false</option>
                                                            </Form.Select>
                                                        </Form.Group>
                                                    </Col>
                                                </>
                                            )}
                                            {condition.name === 'currentAIDMapBool' && (
                                                <>
                                                    <Col md={3}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Map Name*</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={condition.map || ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'map', e.target.value)}
                                                                placeholder="e.g., whichRetreats"
                                                            />
                                                        </Form.Group>
                                                    </Col>
                                                    <Col md={3}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Bool Name*</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={condition.boolName || ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'boolName', e.target.value)}
                                                                placeholder="e.g., mahayana"
                                                            />
                                                        </Form.Group>
                                                    </Col>
                                                    <Col md={2}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Bool Value*</Form.Label>
                                                            <Form.Select
                                                                value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                            >
                                                                <option value="true">true</option>
                                                                <option value="false">false</option>
                                                            </Form.Select>
                                                        </Form.Group>
                                                    </Col>
                                                </>
                                            )}
                                            {condition.name === 'poolMember' && (
                                                <Col md={8}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Pool Name*</Form.Label>
                                                        <Form.Control
                                                            type="text"
                                                            list={`condition-pool-${index}`}
                                                            value={condition.pool || ''}
                                                            onChange={(e) => handleUpdateViewCondition(index, 'pool', e.target.value)}
                                                            placeholder="Select pool"
                                                        />
                                                        <datalist id={`condition-pool-${index}`}>
                                                            {allPools.map(pool => (
                                                                <option key={pool.name} value={pool.name} />
                                                            ))}
                                                        </datalist>
                                                    </Form.Group>
                                                </Col>
                                            )}
                                            {(condition.name === 'offering' || condition.name === 'deposit') && (
                                                <Col md={8}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Bool Value*</Form.Label>
                                                        <Form.Select
                                                            value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                            onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                        >
                                                            <option value="true">true</option>
                                                            <option value="false">false</option>
                                                        </Form.Select>
                                                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                            {condition.name === 'offering'
                                                                ? 'Filter by whether student has made an offering'
                                                                : 'Filter by whether student has made a deposit'}
                                                        </Form.Text>
                                                    </Form.Group>
                                                </Col>
                                            )}
                                            {(condition.name === 'spokenLanguage' || condition.name === 'writtenLanguage') && (
                                                <>
                                                    <Col md={4}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Language*</Form.Label>
                                                            <Form.Control
                                                                type="text"
                                                                value={condition.stringValue || ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'stringValue', e.target.value)}
                                                                placeholder={condition.name === 'spokenLanguage' ? 'e.g., English, Spanish' : 'e.g., English, Spanish'}
                                                            />
                                                        </Form.Group>
                                                    </Col>
                                                    <Col md={4}>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Bool Value*</Form.Label>
                                                            <Form.Select
                                                                value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                                onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                            >
                                                                <option value="true">true (match)</option>
                                                                <option value="false">false (exclude)</option>
                                                            </Form.Select>
                                                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                                {condition.name === 'spokenLanguage'
                                                                    ? 'true: show only this language, false: exclude this language'
                                                                    : 'true: show only this language, false: exclude this language'}
                                                            </Form.Text>
                                                        </Form.Group>
                                                    </Col>
                                                </>
                                            )}
                                        </Row>
                                        <div className="d-flex justify-content-end mt-2">
                                            <Button
                                                variant="outline-danger"
                                                size="sm"
                                                onClick={() => handleDeleteViewCondition(index)}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div style={{ color: '#aaa', textAlign: 'center', padding: '1rem' }}>
                                    No view conditions
                                </div>
                            )}
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowViewsModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveView}>
                        Save View
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Delete View Confirmation Modal */}
            <Modal show={showDeleteViewConfirm} onHide={() => setShowDeleteViewConfirm(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Confirm Delete</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    Are you sure you want to delete the view "{viewFormData.name}"? This action cannot be undone.
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowDeleteViewConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteView}>
                        Delete View
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Prompts Edit/Duplicate Modal */}
            <Modal show={showPromptsModal} onHide={() => setShowPromptsModal(false)} size="xl">
                <Modal.Header closeButton>
                    <Modal.Title>
                        {isDuplicatingPrompts ? 'Duplicate Prompts' : 'Edit Prompts'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <Form>
                        <div className="card">
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Event Code (aid)*</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={promptsEditAid}
                                            onChange={(e) => setPromptsEditAid(e.target.value)}
                                            disabled={!isDuplicatingPrompts}
                                            style={{
                                                backgroundColor: '#2b2b2b',
                                                color: !isDuplicatingPrompts ? '#aaa' : 'white',
                                                border: '1px solid #555',
                                                cursor: !isDuplicatingPrompts ? 'not-allowed' : 'text'
                                            }}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <div style={{ marginTop: '2rem', color: '#aaa' }}>
                                        {promptsEditData.length} prompts total
                                    </div>
                                </Col>
                            </Row>
                        </div>

                        <div className="card" style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                            <h5 style={{ color: '#818cf8', marginBottom: '1rem' }}>Global Find & Replace (Case-Sensitive)</h5>
                            <Row>
                                <Col md={5}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Find</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={promptsFindText}
                                            onChange={(e) => setPromptsFindText(e.target.value)}
                                            placeholder="e.g., Dec 7-8"
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={5}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Replace With</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={promptsReplaceText}
                                            onChange={(e) => setPromptsReplaceText(e.target.value)}
                                            placeholder="e.g., Dec 13-14"
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={2} style={{ display: 'flex', alignItems: 'end' }}>
                                    <Button
                                        variant="primary"
                                        onClick={handleReplaceAllInPrompts}
                                        style={{ marginBottom: '1rem', width: '100%' }}
                                    >
                                        Replace All
                                    </Button>
                                </Col>
                            </Row>
                            <Form.Text className="text-muted">
                                This will replace all occurrences in the text fields of all prompts shown below (case-sensitive).
                            </Form.Text>
                        </div>

                        <div className="card">
                            <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Prompts</h5>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid #555' }}>
                                            <th style={{ padding: '0.75rem', textAlign: 'left', color: '#ffc107', width: '250px' }}>Prompt</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'left', color: '#ffc107', width: '80px' }}>Lang</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'left', color: '#ffc107' }}>Text</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {promptsEditData.map((prompt, index) => {
                                            // Extract prompt name from original prompt field
                                            const promptParts = prompt.prompt.split('-');
                                            const promptName = promptParts.slice(1).join('-');
                                            // Dynamically show current aid + promptName
                                            const displayPrompt = `${promptsEditAid}-${promptName}`;

                                            return (
                                                <tr key={`${prompt.prompt}-${prompt.language}`} style={{ borderBottom: '1px solid #333' }}>
                                                    <td style={{ padding: '0.75rem', color: 'white', fontSize: '0.85rem' }}>
                                                        {displayPrompt}
                                                    </td>
                                                    <td style={{ padding: '0.75rem', color: '#aaa', fontSize: '0.85rem' }}>
                                                        {prompt.language}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <Form.Control
                                                            as="textarea"
                                                            rows={2}
                                                            value={prompt.text || ''}
                                                            onChange={(e) => {
                                                                const newData = [...promptsEditData];
                                                                newData[index] = { ...newData[index], text: e.target.value };
                                                                setPromptsEditData(newData);
                                                            }}
                                                            style={{
                                                                backgroundColor: '#2b2b2b',
                                                                color: 'white',
                                                                border: '1px solid #555',
                                                                fontSize: '0.9rem',
                                                                width: '100%'
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowPromptsModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSavePrompts}>
                        {isDuplicatingPrompts ? 'Save Duplicated Prompts' : 'Save Changes'}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Create Prompts Modal */}
            <Modal show={showCreatePromptsModal} onHide={() => setShowCreatePromptsModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Create New Prompts</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Event Code (aid)*</Form.Label>
                            <EventCodeAutocomplete
                                value={createPromptsAid}
                                onChange={(value) => setCreatePromptsAid(value)}
                                placeholder="Select or enter event code"
                                label=""
                                id="create-prompts-aid"
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Template Type*</Form.Label>
                            <Form.Select
                                value={createPromptsTemplate}
                                onChange={(e) => setCreatePromptsTemplate(e.target.value)}
                                style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                            >
                                <option value="basicSupplication">basicSupplication</option>
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowCreatePromptsModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleCreatePrompts}>
                        Create Prompts
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Saving Prompts Progress Modal */}
            <Modal show={showSavingPromptsModal} onHide={() => { }} backdrop="static" keyboard={false}>
                <Modal.Body style={{ textAlign: 'center', padding: '2rem' }}>
                    <Spinner animation="border" variant="warning" style={{ marginBottom: '1rem' }} />
                    <div style={{ color: 'white', fontSize: '1.1rem' }}>
                        Saving prompts...
                    </div>
                    <div style={{ color: '#aaa', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                        Please wait while prompts are being saved.
                    </div>
                </Modal.Body>
            </Modal>
        </>
    );
};

export default Home;

