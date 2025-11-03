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
    putTableItem
} from 'sharedFrontend';

// Types
interface Event {
    aid: string;
    name: string;
    config?: any;
    embeddedEmails?: any;
    subEvents?: { [key: string]: SubEvent };
    [key: string]: any;
}

interface SubEvent {
    date?: string;
    embeddedEmails?: any;
    embeddedVideoList?: any[];
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

interface Pool {
    name: string;
    description?: string;
    attributes?: PoolAttribute[];
    [key: string]: any;
}

interface PoolAttribute {
    name?: string;
    aid?: string;
    type: string;
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

type ResourceType = 'prompts' | 'events' | 'pools' | 'scripts' | 'offerings';

// Available script step definitions (from join.js stepDefs)
const AVAILABLE_SCRIPT_STEPS = [
    'writtenTranslation', 'spokenTranslation', 'location', 'motivation', 'experience',
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
    const [version, setVersion] = useState<string>("dev");

    // Filtered lists
    const [filteredEvents, setFilteredEvents] = useState<Event[]>([]);
    const [filteredPools, setFilteredPools] = useState<Pool[]>([]);
    const [filteredScripts, setFilteredScripts] = useState<Script[]>([]);
    const [filteredOfferings, setFilteredOfferings] = useState<OfferingConfig[]>([]);
    const [filteredPromptGroups, setFilteredPromptGroups] = useState<PromptGroup[]>([]);

    // Modal states
    const [showEventModal, setShowEventModal] = useState(false);
    const [showPoolModal, setShowPoolModal] = useState(false);
    const [showScriptModal, setShowScriptModal] = useState(false);
    const [showOfferingModal, setShowOfferingModal] = useState(false);
    const [showPromptsModal, setShowPromptsModal] = useState(false);
    const [showSubEventModal, setShowSubEventModal] = useState(false);
    const [showDeleteEventConfirm, setShowDeleteEventConfirm] = useState(false);
    const [showDeletePoolConfirm, setShowDeletePoolConfirm] = useState(false);
    const [showDeleteScriptConfirm, setShowDeleteScriptConfirm] = useState(false);
    const [showDeleteOfferingConfirm, setShowDeleteOfferingConfirm] = useState(false);
    const [isNewEvent, setIsNewEvent] = useState(false);
    const [isNewPool, setIsNewPool] = useState(false);
    const [isNewScript, setIsNewScript] = useState(false);
    const [isNewOffering, setIsNewOffering] = useState(false);
    const [isNewSubEvent, setIsNewSubEvent] = useState(false);
    const [isDuplicatingPrompts, setIsDuplicatingPrompts] = useState(false);

    // Selected items
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
    const [selectedScript, setSelectedScript] = useState<Script | null>(null);
    const [selectedOffering, setSelectedOffering] = useState<OfferingConfig | null>(null);
    const [selectedPromptGroup, setSelectedPromptGroup] = useState<PromptGroup | null>(null);
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

    const [subEventFormData, setSubEventFormData] = useState<SubEvent>({
        date: '',
        eventComplete: false,
        eventOnDeck: false,
        mediaNotify: false,
        regLinkAvailable: false
    });

    // Prompt editing state
    const [promptsEditAid, setPromptsEditAid] = useState<string>('');
    const [promptsEditData, setPromptsEditData] = useState<Prompt[]>([]);
    const [promptsFindText, setPromptsFindText] = useState<string>('');
    const [promptsReplaceText, setPromptsReplaceText] = useState<string>('');

    const initialLoadStarted = useRef(false);

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

    const calculateVersion = () => {
        if (typeof window !== 'undefined') {
            const hostname = window.location.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                setVersion('localhost');
            } else {
                const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev';
                setVersion(commitSha.substring(0, 7));
            }
        }
    };

    // Helper function to get the earliest date from an event's subevents
    const getEarliestEventDate = (event: Event): Date | null => {
        if (!event.subEvents || Object.keys(event.subEvents).length === 0) {
            return null;
        }
        
        const dates = Object.values(event.subEvents)
            .map(subEvent => subEvent.date)
            .filter(date => date)
            .map(date => new Date(date as string));
        
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
        } else {
            filterOfferings(value);
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
        } else {
            filterOfferings('');
        }
    };

    // Event handlers
    const handleCreateNew = () => {
        if (currentResource === 'events') {
            setIsNewEvent(true);
            setEventFormData({
                aid: '',
                name: '',
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
        } else {
            setIsNewOffering(true);
            setOfferingFormData({
                oid: '',
                amounts: [0, 0, 0, 0, 0],
                fees: [0, 0, 0, 0, 0],
                prompts: []
            });
            setShowOfferingModal(true);
        }
    };

    const handleEditEvent = (event: Event) => {
        setIsNewEvent(false);
        setSelectedEvent(event);
        setEventFormData({ ...event });
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
            
            setShowPromptsModal(false);
        } catch (error) {
            console.error('Error saving prompts:', error);
            toast.error('Failed to save prompts');
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

            await putTableItem('events', eventFormData.aid, eventFormData, pid as string, hash as string);
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
            regLinkAvailable: false
        });
        setShowSubEventModal(true);
    };

    const handleEditSubEvent = (key: string, subEvent: SubEvent) => {
        setIsNewSubEvent(false);
        setSelectedSubEventKey(key);
        setSubEventFormData({ ...subEvent });
        setShowSubEventModal(true);
    };

    const handleSaveSubEvent = () => {
        if (isNewSubEvent) {
            const key = prompt('Enter subevent key (e.g., "weekend1", "retreat"):');
            if (!key) return;
            
            setEventFormData(prev => ({
                ...prev,
                subEvents: {
                    ...prev.subEvents,
                    [key]: subEventFormData
                }
            }));
        } else {
            setEventFormData(prev => ({
                ...prev,
                subEvents: {
                    ...prev.subEvents,
                    [selectedSubEventKey]: subEventFormData
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

    // Main initialization effect
    useEffect(() => {
        if (!router.isReady || !pid || !hash) return;
        if (initialLoadStarted.current) return;

        initialLoadStarted.current = true;

        const loadInitialData = async () => {
            try {
                setLoadingProgress({ current: 0, total: 1, message: 'Starting data load...' });
                calculateVersion();

                // Fetch all data
                const [events, pools, scripts, offerings, prompts] = await Promise.all([
                    fetchEvents(),
                    fetchPools(),
                    fetchScripts(),
                    fetchOfferings(),
                    fetchPrompts()
                ]);

                const eventsArray = Array.isArray(events) ? events : [];
                const poolsArray = Array.isArray(pools) ? pools : [];
                const scriptsArray = Array.isArray(scripts) ? scripts : [];
                const offeringsArray = Array.isArray(offerings) ? offerings : [];
                const promptsArray = Array.isArray(prompts) ? prompts : [];

                allEvents = eventsArray;
                allPools = poolsArray;
                allScripts = scriptsArray;
                allOfferings = offeringsArray;
                allPrompts = promptsArray;

                // Group prompts by aid after events are loaded
                groupPromptsByAid();

                // Apply filters (which includes sorting) instead of setting directly
                filterEvents('');
                filterPromptGroups('');
                filterPools('');
                filterScripts('');
                filterOfferings('');

                console.log('Data loaded - Events:', eventsArray.length, 'Pools:', poolsArray.length, 'Scripts:', scriptsArray.length, 'Offerings:', offeringsArray.length, 'Prompts:', promptsArray.length);

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
                            <Badge bg="secondary">v{version}</Badge>
                        </div>
                        <div className="navbar-right">
                            <input
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                type="text"
                                placeholder={`Search ${currentResource}...`}
                                className="search-input"
                            />
                            {currentResource !== 'prompts' && (
                                <Button variant="warning" onClick={handleCreateNew}>
                                    + Create New {currentResource === 'events' ? 'Event' : currentResource === 'pools' ? 'Pool' : currentResource === 'scripts' ? 'Script' : 'Offering'}
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
                                    <div style={{ flex: 1 }}>
                                        <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                            {group.eventDate ? `${group.eventDate} - ` : ''}{group.eventName || group.aid}
                                        </h5>
                                        <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                            Code: {group.aid} • {group.prompts.length} prompts
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <Button
                                            variant="outline-info"
                                            size="sm"
                                            onClick={() => handleEditPrompts(group)}
                                        >
                                            ✏️ Edit
                                        </Button>
                                        <Button
                                            variant="outline-warning"
                                            size="sm"
                                            onClick={() => handleDuplicatePrompts(group)}
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
                            const dateDisplay = earliestDate 
                                ? earliestDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                : 'No date';
                            
                            return (
                                <div key={event.aid} className="event-item">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <div style={{ flex: 1 }} onClick={() => handleEditEvent(event)}>
                                            <h5 style={{ color: '#ffc107', marginBottom: '0.5rem' }}>
                                                {dateDisplay} - {event.name}
                                            </h5>
                                            <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
                                                Code: {event.aid} • Pool: {event.config?.pool || 'Not set'}
                                                {event.subEvents && ` • ${Object.keys(event.subEvents).length} subevents`}
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
                                        <Form.Label>Event Name (Description)*</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={eventFormData.name}
                                            onChange={(e) => setEventFormData({ ...eventFormData, name: e.target.value })}
                                            placeholder="e.g., Vermont In-Person Retreats 2025"
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Eligibility Pool</Form.Label>
                                        <Form.Select
                                            value={eventFormData.config?.pool || ''}
                                            onChange={(e) => setEventFormData({
                                                ...eventFormData,
                                                config: { ...eventFormData.config, pool: e.target.value }
                                            })}
                                        >
                                            <option value="">Select a pool...</option>
                                            {allPools.map(pool => (
                                                <option key={pool.name} value={pool.name}>
                                                    {pool.name} {pool.description && `- ${pool.description}`}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Script Name</Form.Label>
                                        <Form.Select
                                            value={eventFormData.config?.scriptName || ''}
                                            onChange={(e) => setEventFormData({
                                                ...eventFormData,
                                                config: { ...eventFormData.config, scriptName: e.target.value }
                                            })}
                                        >
                                            <option value="">Select a script...</option>
                                            {allScripts.map(script => (
                                                <option key={script.name} value={script.name}>
                                                    {script.name}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                            </Row>
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
                        </div>

                        {/* Config Section (collapsed by default) */}
                        <Accordion className="mb-3">
                            <Accordion.Item eventKey="0">
                                <Accordion.Header>Advanced Configuration (JSON)</Accordion.Header>
                                <Accordion.Body>
                                    <Form.Group>
                                        <Form.Label>Config Object (JSON)</Form.Label>
                                        <Form.Control
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
                                            style={{ fontFamily: 'monospace' }}
                                        />
                                    </Form.Group>
                                </Accordion.Body>
                            </Accordion.Item>
                        </Accordion>

                        {/* SubEvents Section */}
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
                                poolFormData.attributes.map((attr, index) => (
                                    <div key={index} className="subevent-item mb-2">
                                        <Row>
                                            <Col md={4}>
                                                <Form.Group>
                                                    <Form.Label>Type</Form.Label>
                                                    <Form.Select
                                                        value={attr.type}
                                                        onChange={(e) => handleUpdatePoolAttribute(index, 'type', e.target.value)}
                                                    >
                                                        <option value="pool">pool</option>
                                                        <option value="oath">oath</option>
                                                        <option value="join">join</option>
                                                    </Form.Select>
                                                </Form.Group>
                                            </Col>
                                            <Col md={attr.type === 'pool' ? 6 : 6}>
                                                <Form.Group>
                                                    <Form.Label>{attr.type === 'pool' ? 'Pool Name' : 'Event AID'}</Form.Label>
                                                    <Form.Control
                                                        type="text"
                                                        value={attr.type === 'pool' ? attr.name || '' : attr.aid || ''}
                                                        onChange={(e) => handleUpdatePoolAttribute(
                                                            index,
                                                            attr.type === 'pool' ? 'name' : 'aid',
                                                            e.target.value
                                                        )}
                                                        placeholder={attr.type === 'pool' ? 'Pool name' : 'Event AID'}
                                                    />
                                                </Form.Group>
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
                                ))
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
                                    {AVAILABLE_SCRIPT_STEPS.map(step => {
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
                                                            <span>{step}</span>
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
                                    })}
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
        </>
    );
};

export default Home;

