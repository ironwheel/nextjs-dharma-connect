import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Button, Spinner } from "react-bootstrap";
import { ToastContainer, toast } from 'react-toastify';
import { isMobile } from 'react-device-detect';
import Modal from 'react-bootstrap/Modal';

import 'react-toastify/dist/ReactToastify.css';

// Import sharedFrontend utilities
import {
    getAllTableItems,
    updateTableItem,
    getTableItemOrNull,
    batchGetTableItems,
    putTableItem,
    authGetViews,
    authGetConfigValue,
    useWebSocket,
    getTableCount,
    checkEligibility,
    deleteTableItem,
    Pool
} from 'sharedFrontend';

// Import custom DataTable component
import { DataTable, Column } from '../components/DataTable';

// Types
interface Student {
    id: string;
    first: string;
    last: string;
    email: string;
    programs: Record<string, any>;
    practice: Record<string, any>;
    emails: Record<string, any>;
    offeringHistory: Record<string, any>;
    spokenLangPref?: string;
    writtenLangPref?: string;
    unsubscribe?: boolean;
    owyaaLease?: string;
    [key: string]: any;
}

interface Event {
    aid: string;
    name: string;
    subEvents: Record<string, any>;
    config: any;
    hide?: boolean;
    selectedSubEvent?: string;
    list?: boolean;
}



interface View {
    name: string;
    columnDefs: Array<{
        name: string;
        headerName: string;
        boolName?: string;
        stringName?: string;
        numberName?: string;
        pool?: string;
        aid?: string;
    }>;
    conditions: Array<{
        name: string;
        boolName: string;
        boolValue: boolean;
    }>;
}

// Module-level variables
let allStudents: Student[] = [];
let allEvents: Event[] = [];
let allPools: Pool[] = [];
let eligibleStudents: Student[] = [];
let columnMetaData: Record<string, any> = {};
let currentEvent: Event | null = null;

function deepMerge(target: any, source: any): any {
    if (typeof target !== 'object' || typeof source !== 'object' || target === null || source === null) {
        return source;
    }
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function fromDynamo(item: any): any {
    if (item === null || item === undefined) return item;
    if (item.S !== undefined) return item.S;
    if (item.N !== undefined) return Number(item.N);
    if (item.BOOL !== undefined) return item.BOOL;
    if (item.L !== undefined) return item.L.map(fromDynamo);
    if (item.M !== undefined) {
        const obj: any = {};
        for (const k in item.M) {
            obj[k] = fromDynamo(item.M[k]);
        }
        return obj;
    }
    return item;
}

// StudentHistoryModal component
const StudentHistoryModal = ({ show, onClose, student, fetchConfig, allEvents, allPools, emailDisplayPermission, userEventAccess }) => {
    const [copying, setCopying] = React.useState(false);
    const [sortColumn, setSortColumn] = React.useState<'date' | 'event' | 'eligible' | 'joined' | 'offering'>('date');
    const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
    const [regDomain, setRegDomain] = React.useState<string>('');
    const [fallbackUrl, setFallbackUrl] = React.useState<string | null>(null);

    // Pre-fetch registration domain when modal opens (fixes Safari clipboard issue)
    React.useEffect(() => {
        if (show) {
            const loadRegDomain = async () => {
                try {
                    const regDomainConfig = await fetchConfig('registrationDomain');
                    const domain = typeof regDomainConfig === 'string' ? regDomainConfig : regDomainConfig?.value || '';
                    setRegDomain(domain);
                } catch (err) {
                    console.error('Error fetching registration domain:', err);
                }
            };
            loadRegDomain();
            // Clear fallback when modal opens
            setFallbackUrl(null);
        }
    }, [show, fetchConfig]);

    // Helper function to mask email in demo mode
    const maskEmail = (email: string, emailDisplayValue: boolean = emailDisplayPermission): string => {
        if (!emailDisplayValue && email) {
            return '**********';
        }
        return email;
    };

    if (!student) return null;
    // Define SubEvent type
    type SubEvent = {
        event: Event;
        subEventKey: string;
        subEventData: any;
        date: string;
        displayText: string;
        eventKey: string;
    };
    // Gather all subevents from allEvents prop (filtered by user's event access)
    const subEvents: SubEvent[] = [];
    if (Array.isArray(allEvents)) {
        allEvents.forEach(event => {
            if (event.hide) return;

            // Filter events based on user's event access list
            if (userEventAccess && userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                // If user has specific event access (not 'all'), check if this event is allowed
                if (!userEventAccess.includes(event.aid)) {
                    return; // Skip this event if not in user's access list
                }
            }
            const subEventKeys = Object.keys(event.subEvents || {});
            if (subEventKeys.length === 0) {
                subEvents.push({
                    event,
                    subEventKey: '',
                    subEventData: {},
                    date: '',
                    displayText: event.name,
                    eventKey: `${event.aid}`
                });
            } else {
                subEventKeys.forEach(subEventKey => {
                    const subEventData = event.subEvents[subEventKey];
                    const date = subEventData?.date || '';
                    const displayText = (date ? date + ' ' : '') + event.name + (subEventKeys.length > 1 ? ` (${subEventKey})` : '');
                    subEvents.push({
                        event,
                        subEventKey,
                        subEventData,
                        date,
                        displayText,
                        eventKey: `${event.aid}:${subEventKey}`
                    });
                });
            }
        });
    }
    // Use eligibility logic
    const getEligibility = (event: Event, subEventKey: string) => {
        if (!event.config?.pool) return false;
        return checkEligibility(event.config.pool, student, event.aid, allPools);
    };
    // Get offering info
    const getOffering = (event: Event, subEventKey: string) => {
        const prog = student.programs?.[event.aid];
        if (!prog) return '';
        if (prog.offeringHistory && prog.offeringHistory[subEventKey] && prog.offeringHistory[subEventKey].offeringTime) {
            return prog.offeringHistory[subEventKey].offeringTime.slice(0, 10);
        }
        return '';
    };
    // Get attended info
    const getAttended = (event: Event, subEventKey: string) => {
        const prog = student.programs?.[event.aid];
        if (!prog) return false;
        return !!prog.attended;
    };
    // Get accepted info
    const getAccepted = (event: Event, subEventKey: string) => {
        const prog = student.programs?.[event.aid];
        if (!prog) return false;
        return !!prog.accepted;
    };
    // Get joined info
    const getJoined = (event: Event, subEventKey: string) => {
        const prog = student.programs?.[event.aid];
        if (!prog) return false;
        return !!prog.join;
    };
    // Copy to clipboard handler
    const handleCopy = (value: string, label: string) => {
        navigator.clipboard.writeText(value);
        toast.info(`Copied ${label} to the clipboard`, { autoClose: 2000 });
    };
    // Add click handler for event row - uses cached regDomain for Safari compatibility
    const handleEventRowClick = (sub) => {
        const eligible = getEligibility(sub.event, sub.subEventKey);
        if (!eligible) return;

        if (!regDomain) {
            toast.error('Registration domain not loaded yet');
            return;
        }

        setCopying(true);
        const url = `${regDomain}/?pid=${student.id}&aid=${sub.event.aid}`;

        // Try synchronous clipboard write (required for Safari)
        navigator.clipboard.writeText(url)
            .then(() => {
                toast.success(`Registration link copied: ${url}`, { autoClose: 4000 });
                setFallbackUrl(null);
            })
            .catch((err) => {
                console.error('Clipboard write failed:', err);
                // Show fallback UI with the URL for manual copying
                setFallbackUrl(url);
                toast.warning('Could not auto-copy. Please copy the link shown below.', { autoClose: 4000 });
            })
            .finally(() => {
                setCopying(false);
            });
    };
    // Handle column header click for sorting
    const handleSort = (column: 'date' | 'event' | 'eligible' | 'joined' | 'offering') => {
        if (sortColumn === column) {
            // Toggle direction if clicking same column
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // Set new column and default to descending
            setSortColumn(column);
            setSortDirection('desc');
        }
    };
    // Sort subEvents based on current sort column and direction
    const sortedSubEvents = [...subEvents].sort((a, b) => {
        let compareResult = 0;
        switch (sortColumn) {
            case 'date':
                compareResult = (a.date || '').localeCompare(b.date || '');
                break;
            case 'event':
                compareResult = a.displayText.localeCompare(b.displayText);
                break;
            case 'eligible':
                const aEligible = getEligibility(a.event, a.subEventKey);
                const bEligible = getEligibility(b.event, b.subEventKey);
                compareResult = (aEligible ? 1 : 0) - (bEligible ? 1 : 0);
                break;
            case 'joined':
                const aJoined = getJoined(a.event, a.subEventKey);
                const bJoined = getJoined(b.event, b.subEventKey);
                compareResult = (aJoined ? 1 : 0) - (bJoined ? 1 : 0);
                break;
            case 'offering':
                const aOffering = getOffering(a.event, a.subEventKey);
                const bOffering = getOffering(b.event, b.subEventKey);
                compareResult = (aOffering || '').localeCompare(bOffering || '');
                break;
        }
        return sortDirection === 'asc' ? compareResult : -compareResult;
    });
    // Render sort indicator arrow
    const renderSortArrow = (column: 'date' | 'event' | 'eligible' | 'joined' | 'offering') => {
        if (sortColumn !== column) return '';
        return sortDirection === 'asc' ? ' ↑' : ' ↓';
    };
    // Modal header info
    return (
        <Modal show={show} onHide={onClose} centered size="lg" backdrop="static">
            <Modal.Header closeButton>
                <Modal.Title>
                    Student History: {student.first} {student.last}
                    <span style={{ fontSize: 14, marginLeft: 16, color: '#888', cursor: 'pointer', userSelect: 'all' }}
                        title="Click to copy ID"
                        onClick={() => handleCopy(student.id, 'ID')}
                    >
                        [ID: <u>{student.id}</u>]
                    </span>
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <div style={{ marginBottom: 16 }}>
                    <b>Email:</b>{' '}
                    <span
                        style={{
                            cursor: emailDisplayPermission ? 'pointer' : 'default',
                            textDecoration: emailDisplayPermission ? 'underline dotted' : 'none',
                            color: emailDisplayPermission ? '#60a5fa' : '#888'
                        }}
                        title={emailDisplayPermission ? "Click to copy email" : "Email copy disabled"}
                        onClick={emailDisplayPermission ? () => handleCopy(student.email, 'email') : undefined}
                    >
                        {maskEmail(student.email, emailDisplayPermission)}
                    </span>
                    <br />
                    <b>Country:</b> {student.country || 'Unknown'} <br />
                    <b>Languages:</b> {student.spokenLangPref || ''}{student.writtenLangPref ? ` / ${student.writtenLangPref}` : ''} <br />
                    <b>Refuge:</b> {checkEligibility('refuge', student, 'refuge', allPools) ? <span style={{ color: '#60a5fa', fontSize: '1.2em', fontWeight: 'bold' }}>✓</span> : <span style={{ color: '#ef4444', fontSize: '1.2em', fontWeight: 'bold' }}>✗</span>} <br />
                    <b>Oathed:</b> {checkEligibility('oath', student, 'oath', allPools) ? <span style={{ color: '#60a5fa', fontSize: '1.2em', fontWeight: 'bold' }}>✓</span> : <span style={{ color: '#ef4444', fontSize: '1.2em', fontWeight: 'bold' }}>✗</span>}
                    <br />
                </div>
                {fallbackUrl && (
                    <div style={{
                        marginBottom: 16,
                        padding: 12,
                        backgroundColor: '#fef3c7',
                        border: '1px solid #f59e0b',
                        borderRadius: 6,
                        color: '#92400e'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
                            📋 Registration Link (Copy manually):
                        </div>
                        <input
                            type="text"
                            value={fallbackUrl}
                            readOnly
                            onClick={(e) => e.currentTarget.select()}
                            style={{
                                width: '100%',
                                padding: 8,
                                border: '1px solid #d97706',
                                borderRadius: 4,
                                backgroundColor: '#fffbeb',
                                color: '#92400e',
                                fontFamily: 'monospace',
                                fontSize: 13
                            }}
                        />
                        <div style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>
                            Click the text box above to select the link, then press Cmd+C (Mac) or Ctrl+C (Windows) to copy.
                        </div>
                    </div>
                )}
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Event Participation</div>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    <table className="table table-sm table-bordered" style={{ position: 'relative' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                            <tr>
                                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('date')}>
                                    Date{renderSortArrow('date')}
                                </th>
                                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('event')}>
                                    Event{renderSortArrow('event')}
                                </th>
                                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('eligible')}>
                                    Eligible{renderSortArrow('eligible')}
                                </th>
                                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('joined')}>
                                    Joined{renderSortArrow('joined')}
                                </th>
                                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('offering')}>
                                    Offering{renderSortArrow('offering')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedSubEvents.map(sub => {
                                const eligible = getEligibility(sub.event, sub.subEventKey);
                                const joined = getJoined(sub.event, sub.subEventKey);
                                const offering = getOffering(sub.event, sub.subEventKey);
                                return (
                                    <tr key={sub.eventKey}>
                                        <td>{sub.date}</td>
                                        <td
                                            style={{ cursor: eligible ? 'pointer' : 'not-allowed', color: eligible ? '#60a5fa' : 'white', textDecoration: eligible ? 'underline dotted' : undefined }}
                                            title={eligible ? 'Click to copy registration link' : 'Student not eligible for this event'}
                                            onClick={() => eligible && handleEventRowClick(sub)}
                                        >
                                            {sub.displayText}
                                        </td>
                                        <td>{eligible ? '✔️' : ''}</td>
                                        <td>{joined ? '✔️' : ''}</td>
                                        <td>{offering}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Modal.Body>
        </Modal>
    );
};

const Home = () => {


    const router = useRouter();
    const { pid, hash } = router.query;

    // Modal state for student history
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
    const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

    const [loaded, setLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });
    const [name, setName] = useState("Unknown");
    const [forceRenderValue, setForceRenderValue] = useState(0);
    const [currentEventAid, setCurrentEventAid] = useState('event-dashboard');
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const [evShadow, setEvShadow] = useState<Event | null>(null);
    const [month, setMonth] = useState("May");
    const [year, setYear] = useState("2025");
    const [view, setView] = useState<string | null>(null);
    const [itemCount, setItemCount] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [columnLabels, setColumnLabels] = useState<Column[]>([]);
    const [rowData, setRowData] = useState<any[]>([]);
    const [lastEvaluatedKey, setLastEvaluatedKey] = useState(null);
    const [views, setViews] = useState<string[]>([]);
    const [allEvents, setAllEvents] = useState<Event[]>([]);
    const [allStudents, setAllStudents] = useState<Student[]>([]);
    const [allPools, setAllPools] = useState<Pool[]>([]);
    const [studentUpdateCount, setStudentUpdateCount] = useState(0);
    const initialLoadStarted = useRef(false);
    // 1. Add state for error message when view is missing
    const [viewError, setViewError] = useState<string | null>(null);
    const [canWriteViews, setCanWriteViews] = useState<boolean>(false);
    const [canExportCSV, setCanExportCSV] = useState<boolean>(false);
    const [currentViewConditions, setCurrentViewConditions] = useState<any[]>([]);
    const [canViewStudentHistory, setCanViewStudentHistory] = useState<boolean>(false);
    const [currentUserName, setCurrentUserName] = useState<string>("Unknown");
    const [emailDisplayPermission, setEmailDisplayPermission] = useState<boolean>(false);
    const [userEventAccess, setUserEventAccess] = useState<string[]>([]);
    const [userListAccess, setUserListAccess] = useState<boolean>(false);
    const [canRefreshCache, setCanRefreshCache] = useState<boolean>(false);
    const [eventListSearchTerm, setEventListSearchTerm] = useState<string>('');
    // Add new state for currentEligibleStudents
    const [currentEligibleStudents, setCurrentEligibleStudents] = useState<Student[]>([]);
    // Add state for eligibility caching system
    const [allStudentsLoaded, setAllStudentsLoaded] = useState<boolean>(false);
    const [loadingEligibilityCache, setLoadingEligibilityCache] = useState<boolean>(false);
    const [allStudentsLoadedForCurrentEvent, setAllStudentsLoadedForCurrentEvent] = useState<boolean>(false);
    // Use a ref to maintain accumulated eligible students across callbacks
    const accumulatedEligibleStudentsRef = useRef<Student[]>([]);
    const currentLoadingAbortControllerRef = useRef<AbortController | null>(null);
    let demoMode = false;

    // WebSocket connection
    const { lastMessage, sendMessage, status, connectionId } = useWebSocket();

    // Component-specific helper functions
    const forceRender = useCallback(() => setForceRenderValue(v => v + 1), []);

    // Add function to calculate eligible students for a given event
    const calculateEligibleStudents = useCallback((currentEvent: Event, students: Student[], pools: Pool[]): Student[] => {
        const eligibleStudents: Student[] = [];

        if (currentEvent && Array.isArray(students)) {
            students.forEach((student, index) => {
                if (student.unsubscribe) {
                    return;
                }
                if (currentEvent.config?.pool && Array.isArray(pools) && pools.length > 0) {
                    const isEligible = checkEligibility(currentEvent.config.pool, student, currentEvent.aid, pools);
                    if (isEligible) {
                        eligibleStudents.push(student);
                    }
                }
            });
            eligibleStudents.sort(compareNames);
        }

        return eligibleStudents;
    }, []);

    // Function to create eligibility cache record
    const createEligibilityCacheRecord = async (eventAid: string, eligibleStudentIds: string[]) => {
        try {
            const cacheRecord = {
                aid: eventAid,
                createdAt: new Date().toISOString(),
                studentIdList: eligibleStudentIds
            };

            // Use putTableItem to create the entire record
            await putTableItem('eligibility-cache', eventAid, cacheRecord, pid as string, hash as string);
        } catch (error) {
            console.error('Error creating eligibility cache record:', error);
        }
    };

    // Helper function to mask email based on email display permission
    const maskEmail = (email: string, emailDisplayValue: boolean = emailDisplayPermission): string => {
        if (!emailDisplayValue && email) {
            return '**********';
        }
        return email;
    };

    // API functions using sharedFrontend
    const fetchStudents = async () => {
        try {
            // First, try to get the total count
            let totalCount = 0;
            try {
                const countResponse = await getTableCount('students', pid as string, hash as string);
                if (countResponse && !('redirected' in countResponse) && countResponse.count) {
                    totalCount = countResponse.count;
                    setLoadingProgress(prev => ({
                        ...prev,
                        total: totalCount,
                        message: `Loading all students...`
                    }));
                }
            } catch (countError) {
                console.log('Could not get total count, will estimate:', countError);
            }

            const students = await getAllTableItems('students', pid as string, hash as string, (count, chunkNumber, totalChunks) => {
                setLoadingProgress(prev => ({
                    ...prev,
                    current: count,
                    total: totalCount || Math.max(count, prev.total), // Use actual total if available
                    message: `Loading all students...`
                }));
            });

            // Check if we got a redirected response
            if (students && 'redirected' in students) {
                console.log('Students fetch redirected - authentication required');
                return [];
            }

            setAllStudentsLoaded(true);
            return students as Student[];
        } catch (error) {
            console.error('Error fetching students:', error);
            toast.error('Failed to fetch students');
            return [];
        }
    };

    // Function to load students for a specific event using eligibility cache with incremental updates
    const loadStudentsForEvent = async (
        eventAid: string,
        eventsArray?: Event[],
        poolsArray?: Pool[],
        onIncrementalUpdate?: (eligibleStudents: Student[]) => void,
        abortController?: AbortController
    ): Promise<Student[]> => {
        try {
            setLoadingEligibilityCache(true);
            setLoadingProgress(prev => ({
                ...prev,
                current: 0,
                total: 0,
                message: `Loading eligibility cache for ${eventAid}...`
            }));

            // Get the current event for eligibility calculation
            const eventsToSearch = eventsArray || allEvents;
            const currentEvent = eventsToSearch.find(e => e.aid === eventAid);
            if (!currentEvent) {
                console.error(`Event ${eventAid} not found in events:`, eventsToSearch.map(e => e.aid));
                setLoadingEligibilityCache(false);
                return [];
            }

            // STEP 1: Check eligibility on existing students and display them immediately
            const existingEligibleStudents = calculateEligibleStudents(currentEvent, allStudents, poolsArray || allPools);
            const alreadyHaveStudentIds = new Set(existingEligibleStudents.map(s => s.id));

            console.log(`Found ${existingEligibleStudents.length} eligible students from existing data`);

            // Display existing eligible students immediately
            if (onIncrementalUpdate && existingEligibleStudents.length > 0) {
                console.log('Displaying existing eligible students immediately');
                onIncrementalUpdate(existingEligibleStudents);
            }

            // Check if eligibility cache is disabled for this event
            const cacheDisabled = currentEvent.config?.eligibilityCacheDisabled === true;

            // First, check if we have an eligibility cache record for this event (if not disabled)
            let cacheRecord: any = null;
            if (!cacheDisabled) {
                cacheRecord = await getTableItemOrNull('eligibility-cache', eventAid, pid as string, hash as string);
            } else {
                console.log(`Eligibility cache disabled for event ${eventAid}`);
            }

            if (cacheRecord && !('redirected' in cacheRecord) && cacheRecord.studentIdList) {
                // STEP 2: Filter cache to exclude students already loaded globally
                const existingStudentIds = new Set(allStudents.map(s => s.id));
                const missingStudentIds = cacheRecord.studentIdList.filter(id => !existingStudentIds.has(id));

                console.log(`Cache has ${cacheRecord.studentIdList.length} students, ${existingStudentIds.size} already loaded globally, ${missingStudentIds.length} need to be loaded`);

                if (missingStudentIds.length === 0) {
                    setLoadingEligibilityCache(false);
                    setAllStudentsLoadedForCurrentEvent(true);
                    console.log('No missing students to load from cache, all eligible students already loaded');

                    // Ensure current user is included in the result
                    const finalStudents = [...existingEligibleStudents];
                    const currentUserIncluded = finalStudents.some(student => student.id === pid);

                    if (!currentUserIncluded && pid) {
                        const currentUser = allStudents.find(student => student.id === pid);
                        if (currentUser) {
                            finalStudents.push(currentUser);
                        }
                    }

                    console.log(`Returning ${finalStudents.length} eligible students (all from existing data)`);
                    return finalStudents;
                }
                setLoadingProgress(prev => ({
                    ...prev,
                    current: 0,
                    total: missingStudentIds.length,
                    message: `Loading ${missingStudentIds.length} students from cache...`
                }));

                // Load missing students in batches with incremental updates
                const newStudents: Student[] = [];
                const BATCH_SIZE = 100;
                let updatedStudents = [...allStudents]; // Track the updated students list

                for (let i = 0; i < missingStudentIds.length; i += BATCH_SIZE) {
                    // Check if operation was aborted
                    if (abortController?.signal.aborted) {
                        throw new Error('Operation aborted');
                    }

                    const batch = missingStudentIds.slice(i, i + BATCH_SIZE);
                    const batchStudents = await batchGetTableItems('students', batch, pid as string, hash as string);

                    if (batchStudents && !('redirected' in batchStudents)) {
                        newStudents.push(...batchStudents);
                        setLoadingProgress(prev => ({
                            ...prev,
                            current: Math.min(i + BATCH_SIZE, missingStudentIds.length),
                            total: missingStudentIds.length,
                            message: `Loading ${missingStudentIds.length} students from cache...`
                        }));

                        // Update allStudents incrementally, avoiding duplicates
                        const addedStudentIds = new Set<string>();

                        for (const newStudent of batchStudents) {
                            // Check if student already exists in allStudents
                            const studentExists = updatedStudents.some(existing => existing.id === newStudent.id);
                            if (!studentExists) {
                                updatedStudents.push(newStudent);
                                addedStudentIds.add(newStudent.id);
                            } else {
                                console.log(`Skipping duplicate student: ${newStudent.id} (${newStudent.first} ${newStudent.last})`);
                            }
                        }

                        setAllStudents(updatedStudents);

                        console.log(`Batch processed: ${batchStudents.length} students, added: ${addedStudentIds.size}, skipped: ${batchStudents.length - addedStudentIds.size} duplicates`);

                        // Calculate eligible students from the current batch only
                        const currentBatchEligibleStudents = batchStudents.filter(student =>
                            cacheRecord.studentIdList.includes(student.id)
                        );

                        // Ensure current user is always included in the batch
                        const currentUserIncluded = currentBatchEligibleStudents.some(student => student.id === pid);
                        if (!currentUserIncluded && pid) {
                            const currentUser = batchStudents.find(student => student.id === pid);
                            if (currentUser) {
                                currentBatchEligibleStudents.push(currentUser);
                            }
                        }

                        if (onIncrementalUpdate) {
                            console.log('Calling onIncrementalUpdate with', currentBatchEligibleStudents.length, 'students from current batch');
                            onIncrementalUpdate(currentBatchEligibleStudents);
                        }
                    }
                }

                // Final result - combine existing eligible students with newly loaded ones
                const newlyLoadedEligibleStudents = updatedStudents.filter(student =>
                    cacheRecord.studentIdList.includes(student.id) && !existingEligibleStudents.some(existing => existing.id === student.id)
                );

                const finalStudents = [...existingEligibleStudents, ...newlyLoadedEligibleStudents];
                const currentUserIncluded = finalStudents.some(student => student.id === pid);

                if (!currentUserIncluded && pid) {
                    const currentUser = updatedStudents.find(student => student.id === pid);
                    if (currentUser) {
                        finalStudents.push(currentUser);
                    }
                }

                console.log(`Final result: ${existingEligibleStudents.length} existing + ${newlyLoadedEligibleStudents.length} newly loaded = ${finalStudents.length} total eligible students`);
                console.log(`Global student count: ${updatedStudents.length} (was ${allStudents.length} at start)`);
                setLoadingEligibilityCache(false);
                setAllStudentsLoadedForCurrentEvent(true);
                return finalStudents;
            } else {
                // If no cache exists and we haven't loaded all students yet, load them
                let studentsForEligibility = allStudents;
                if (!allStudentsLoaded) {
                    setLoadingProgress(prev => ({
                        ...prev,
                        current: 0,
                        total: 0,
                        message: `Loading all students for eligibility calculation...`
                    }));

                    const allStudentsData = await fetchStudents();
                    if (allStudentsData.length === 0) {
                        setLoadingEligibilityCache(false);
                        return [];
                    }
                    // Update the allStudents state with the loaded data
                    setAllStudents(allStudentsData);
                    studentsForEligibility = allStudentsData;
                }

                // Calculate eligibility for the event
                const eventsToSearch = eventsArray || allEvents;
                const event = eventsToSearch.find(e => e.aid === eventAid);
                if (!event) {
                    console.error(`Event ${eventAid} not found in events:`, eventsToSearch.map(e => e.aid));
                    setLoadingEligibilityCache(false);
                    return [];
                }

                const eligibleStudents = calculateEligibleStudents(event, studentsForEligibility, poolsArray || allPools);

                // Ensure current user is always included in the returned students
                const finalEligibleStudents = [...eligibleStudents];
                const currentUserIncluded = finalEligibleStudents.some(student => student.id === pid);

                if (!currentUserIncluded && pid) {
                    const currentUser = studentsForEligibility.find(student => student.id === pid);
                    if (currentUser) {
                        finalEligibleStudents.push(currentUser);
                    }
                }

                // Create cache record for future use (only include originally eligible students)
                // Only if cache is not disabled
                if (!cacheDisabled) {
                    const eligibleStudentIds = eligibleStudents.map(s => s.id);
                    await createEligibilityCacheRecord(eventAid, eligibleStudentIds);
                }

                // Trigger incremental update with final result
                if (onIncrementalUpdate) {
                    console.log('Calling onIncrementalUpdate with final result:', finalEligibleStudents.length, 'students');
                    onIncrementalUpdate(finalEligibleStudents);
                }

                setLoadingEligibilityCache(false);
                return finalEligibleStudents;
            }
        } catch (error) {
            console.error('Error loading students for event:', error);
            setLoadingEligibilityCache(false);
            return [];
        }
    };

    const fetchEvents = async () => {
        try {
            const events = await getAllTableItems('events', pid as string, hash as string);

            // Check if we got a redirected response
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

            // Check if we got a redirected response
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

    // Cache for view definitions to avoid repeated backend calls
    const viewCache = new Map<string, View | null>();

    // Function to clear the view cache when needed
    const clearViewCache = () => {
        viewCache.clear();
        console.log('View cache cleared');
    };

    // Function to clear cache for a specific view (useful for debugging or manual refresh)
    const clearViewCacheForView = (viewName: string) => {
        viewCache.delete(viewName);
        console.log(`View cache cleared for: ${viewName}`);
    };

    // Function to get cache statistics (useful for debugging)
    const getViewCacheStats = () => {
        const stats = {
            size: viewCache.size,
            keys: Array.from(viewCache.keys()),
            hitRate: 0 // This would need to be tracked separately if needed
        };
        console.log('View cache stats:', stats);
        return stats;
    };

    const fetchView = async (viewName: string) => {
        // Check cache first
        if (viewCache.has(viewName)) {
            console.log(`View cache hit for: ${viewName} (cache size: ${viewCache.size})`);
            return viewCache.get(viewName);
        }

        console.log(`View cache miss for: ${viewName} (cache size: ${viewCache.size})`);

        try {
            // Correct: look in 'views' table, use viewName as-is
            const view = await getTableItemOrNull('views', viewName, pid as string, hash as string);
            if (view && 'redirected' in view) {
                console.log('View fetch redirected - authentication required');
                // Cache the null result to avoid repeated failed requests
                viewCache.set(viewName, null);
                return null;
            }

            // Cache the successful result
            viewCache.set(viewName, view as View);
            console.log(`View cached for: ${viewName} (cache size: ${viewCache.size})`);
            return view as View;
        } catch (error) {
            console.error('Error fetching view:', error);
            // Cache the null result to avoid repeated failed requests
            viewCache.set(viewName, null);
            return null;
        }
    };

    const fetchConfig = async (configName: string) => {
        try {
            const config = await getTableItemOrNull('config', configName, pid as string, hash as string);

            // Check if we got a redirected response
            if (config && 'redirected' in config) {
                console.log(`Config fetch redirected for ${configName} - authentication required`);
                return null;
            }

            return config;
        } catch (error) {
            console.error('Error fetching config:', error);
            return null;
        }
    };

    const fetchViews = async () => {
        try {
            const viewsResponse = await authGetViews(pid as string, hash as string);
            if (viewsResponse && !('redirected' in viewsResponse)) {
                console.log('Views fetched successfully:', viewsResponse);
                return viewsResponse;
            }
            console.log('Views fetch redirected or empty:', viewsResponse);
            return [];
        } catch (error) {
            console.error('Error fetching views:', error);
            toast.error('Failed to fetch views');
            return [];
        }
    };

    const fetchCurrentUser = (studentsArray?: Student[]) => {
        try {
            const studentsToUse = studentsArray || allStudents;

            if (!pid || !Array.isArray(studentsToUse) || studentsToUse.length === 0) {
                console.log('fetchCurrentUser: pid:', pid);
                console.log('fetchCurrentUser: studentsToUse:', studentsToUse?.length || 0);
                setCurrentUserName(`User ${pid || 'Unknown'}`);
                return;
            }

            // Find the current user in the students array using the pid
            const currentUser = studentsToUse.find(student => student.id === pid);

            if (currentUser) {
                const firstName = currentUser.first || '';
                const lastName = currentUser.last || '';
                const fullName = `${firstName} ${lastName}`.trim();
                setCurrentUserName(fullName || 'Unknown User');
            } else {
                // If we can't find the user in the array, use the pid as a fallback
                setCurrentUserName(`User ${pid}`);
                console.log('fetchCurrentUser: currentUser not found:', currentUser);
            }
        } catch (error) {
            console.error('Error setting current user name:', error);
            setCurrentUserName(`User ${pid || 'Unknown'}`);
        }
    };

    const fetchCurrentUserLastUsedConfig = async () => {
        try {
            if (!pid || typeof pid !== 'string') {
                console.log('fetchCurrentUserLastUsedConfig: No pid available');
                return null;
            }

            const studentRecord = await getTableItemOrNull('students', pid, pid, hash as string);

            // Check if we got a redirected response
            if (studentRecord && 'redirected' in studentRecord) {
                console.log('Student record fetch redirected - authentication required');
                return null;
            }

            return studentRecord;
        } catch (error) {
            console.error('Error fetching current user student record:', error);
            return null;
        }
    };

    const updateUserEventDashboardLastUsedConfig = async (updates: {
        event?: string;
        subEvent?: string;
        view?: string;
    }) => {
        try {
            if (!pid || typeof pid !== 'string') {
                console.log('updateUserEventDashboardLastUsedConfig: No pid available');
                return false;
            }

            // Get current student record
            const currentStudentRecord = await fetchCurrentUserLastUsedConfig();
            if (!currentStudentRecord) {
                console.log('updateUserEventDashboardLastUsedConfig: Could not fetch current student record');
                return false;
            }

            // Update the eventDashboardLastUsedConfig
            const updatedEventDashboardLastUsedConfig = {
                ...currentStudentRecord.eventDashboardLastUsedConfig,
                ...updates
            };

            // Update the student record
            await updateTableItem('students', pid, 'eventDashboardLastUsedConfig', updatedEventDashboardLastUsedConfig, pid, hash as string);
            console.log('User eventDashboardLastUsedConfig updated successfully:', updates);
            return true;
        } catch (error) {
            console.error('Error updating user eventDashboardLastUsedConfig:', error);
            return false;
        }
    };

    const updateStudentEventField = async (studentId: string, fieldName: string, fieldValue: any) => {
        if (!evShadow || !evShadow.aid) {
            toast.error('No current event selected');
            return false;
        }

        // Find the student to check existing structure
        const student = allStudents.find(s => s.id === studentId);
        if (!student) {
            console.error('Student not found for update:', studentId);
            return false;
        }

        let updatePath = '';
        let updateValue = fieldValue;

        // Determine the correct update path and value based on existing structure
        if (!student.programs) {
            // programs does not exist, create it
            updatePath = 'programs';
            updateValue = { [evShadow.aid]: { [fieldName]: fieldValue } };
            // Optimistically update local state
            student.programs = updateValue;
        } else if (!student.programs[evShadow.aid]) {
            // programs exists but event entry does not, create event entry
            updatePath = `programs.${evShadow.aid}`;
            updateValue = { [fieldName]: fieldValue };
            // Optimistically update local state
            student.programs[evShadow.aid] = updateValue;
        } else {
            // both exist, update the specific field
            updatePath = `programs.${evShadow.aid}.${fieldName}`;
            updateValue = fieldValue;
            // Optimistically update local state
            student.programs[evShadow.aid][fieldName] = fieldValue;
        }

        try {
            await updateTableItem('students', studentId, updatePath, updateValue, pid as string, hash as string);
            toast.success('Field updated successfully');
            return true;
        } catch (error) {
            console.error('Error updating student event field:', error);
            toast.error('Failed to update field');
            return false;
        }
    };

    const compareNames = (a: Student, b: Student) => {
        if (a.first + a.last < b.first + b.last) return -1;
        if (a.first + a.last > b.first + b.last) return 1;
        return 0;
    };

    // Event handlers
    const handleCellValueChanged = async (field: string, rowIndex: number, value: any) => {
        if (!canWriteViews) {
            toast.info('Value not changed. READ ONLY', { autoClose: 3000 });
            return;
        }

        const student = rowData[rowIndex];
        if (!student) return;

        if (field === 'notes') {
            const success = await updateStudentEventField(student.id, 'notes', value);
            if (success) {
                // Update local data
                const updatedRowData = [...rowData];
                updatedRowData[rowIndex] = { ...student, notes: value };
                setRowData(updatedRowData);
            }
        }
    };

    const handleCellClicked = (field: string, rowData: any) => {
        if (field === 'name' && canViewStudentHistory) {
            // Look up the full student object by id
            const student = allStudents.find(s => s.id === rowData.id) || allStudents.find(s => `${s.first} ${s.last}` === rowData.name);
            setSelectedStudent(student || null);
            setShowHistoryModal(true);
        } else if (field === 'email') {
            if (emailDisplayPermission) {
                navigator.clipboard.writeText(rowData.email);
                toast.info(`Copied ${rowData.email} to the clipboard`, { autoClose: 3000 });
            } else {
                toast.info('Email copy disabled', { autoClose: 2000 });
            }
        } else if (field === 'owyaa') {
            handleOWYAA(rowData.id, rowData.name);
        }
    };

    const handleCheckboxChanged = async (field: string, studentId: string, checked: boolean) => {
        if (!canWriteViews) {
            toast.info('Value not changed. READ ONLY', { autoClose: 3000 });
            return;
        }

        // Find the student by ID instead of using row index
        const student = rowData.find(s => s.id === studentId);
        if (!student) {
            console.error('Student not found for ID:', studentId);
            return;
        }

        let dataField = field;
        if (field === 'joined') dataField = 'join';
        if (field === 'installmentsLF') dataField = 'limitFee';

        if (field.startsWith('currentAIDBool')) {
            dataField = columnMetaData[field]?.boolName || field;
        }
        if (field.startsWith('currentAIDMapBool')) {
            dataField = `${columnMetaData[field]?.map}.${columnMetaData[field]?.boolName}` || field;
        }

        const success = await updateStudentEventField(studentId, dataField, checked);
        if (success) {
            // Update local data by finding the correct row index
            const rowIndex = rowData.findIndex(s => s.id === studentId);
            if (rowIndex !== -1) {
                const updatedRowData = [...rowData];
                updatedRowData[rowIndex] = { ...student, [field]: checked };
                setRowData(updatedRowData);
            }
        }
    };

    const handleOWYAA = async (id: string, name: string) => {
        if (!Array.isArray(allStudents)) {
            console.error('allStudents is not an array');
            return;
        }

        const studentIndex = allStudents.findIndex(s => s.id === id);
        if (studentIndex === -1) return;

        const student = allStudents[studentIndex];
        const hasLease = student.owyaaLease;

        if (!hasLease) {
            const leaseTimestamp = new Date().toISOString();
            const success = await updateStudentEventField(id, 'owyaaLease', leaseTimestamp);
            if (success) {
                const updatedStudents = [...allStudents];
                updatedStudents[studentIndex] = { ...student, owyaaLease: leaseTimestamp };
                setAllStudents(updatedStudents);
                toast.info(`OWYAA Enabled for ${name} for 90 days`, { autoClose: 3000 });
            }
        } else {
            const success = await updateStudentEventField(id, 'owyaaLease', '');
            if (success) {
                const updatedStudents = [...allStudents];
                const updatedStudent = { ...student };
                delete updatedStudent.owyaaLease;
                updatedStudents[studentIndex] = updatedStudent;
                setAllStudents(updatedStudents);
                toast.info(`OWYAA DISABLED for ${name}`, { autoClose: 3000 });
            }
        }

        // Refresh table data
        const [cl, rd] = await assembleColumnLabelsAndRowData(view || 'Joined', month, year);
        setColumnLabels(cl);
        setRowData(rd);
    };

    // Search and export functions
    const handleSearch = async (searchValue: string) => {
        setSearchTerm(searchValue);

        // Rebuild the data with the new search term
        if (view) {
            const [cl, rd] = await assembleColumnLabelsAndRowData(view, month, year);
            setColumnLabels(cl);
            setRowData(rd);
        }
    };

    const handleSearchChange = (searchValue: string) => {
        // Immediate search on each character
        handleSearch(searchValue);
    };

    const handleCSVExport = () => {
        if (!canExportCSV) {
            toast.error('You do not have permission to export CSV');
            return;
        }

        if (!rowData || rowData.length === 0) {
            toast.error('No data to export');
            return;
        }

        // Get visible columns (excluding hidden ones)
        const visibleColumns = columnLabels.filter(col => !col.hide);

        // Create CSV headers
        const headers = visibleColumns.map(col => col.headerName || col.field);

        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...rowData.map(row =>
                visibleColumns.map(col => {
                    const value = row[col.field];

                    // Handle different data types
                    let displayValue = '';
                    if (value === null || value === undefined) {
                        displayValue = '';
                    } else if (typeof value === 'boolean') {
                        displayValue = value ? 'Yes' : 'No';
                    } else if (typeof value === 'object') {
                        displayValue = JSON.stringify(value);
                    } else {
                        displayValue = value.toString();
                    }

                    // Escape commas and quotes in CSV
                    if (typeof displayValue === 'string' && (displayValue.includes(',') || displayValue.includes('"') || displayValue.includes('\n'))) {
                        return `"${displayValue.replace(/"/g, '""')}"`;
                    }
                    return displayValue;
                }).join(',')
            )
        ].join('\n');

        // Create and download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename with current date and view name
        const date = new Date().toISOString().split('T')[0];
        const eventName = evShadow?.name || 'unknown-event';
        const viewName = view || 'unknown-view';
        const filename = `event-dashboard-${eventName}-${viewName}-${date}.csv`;

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        toast.success(`CSV exported successfully: ${filename}`);
    };

    // Interface for sub-event items
    interface SubEventItem {
        event: Event;
        subEventKey: string;
        subEventData: any;
        date: string;
        displayText: string;
        eventKey: string;
    }

    // Helper function to format sub-event display
    const formatSubEventDisplay = (event: Event, subEventKey: string, subEventData: any) => {
        const date = subEventData.date || '';
        const hasMultipleSubEvents = Object.keys(event.subEvents || {}).length > 1;

        if (date && hasMultipleSubEvents) {
            return `${date} ${event.name} (${subEventKey})`;
        } else if (date) {
            return `${date} ${event.name}`;
        } else {
            return event.name;
        }
    };

    // Helper function to get all sub-events from all events (excluding lists)
    const getAllSubEvents = (events: Event[]): SubEventItem[] => {
        const subEvents: SubEventItem[] = [];

        // Defensive coding: ensure events is an array
        if (!Array.isArray(events)) {
            return subEvents;
        }

        events.forEach(event => {
            if (event.hide) return; // Skip hidden events
            if (event.list === true) return; // Skip lists (they're handled separately)

            // Filter events based on user's event access list
            if (userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                // If user has specific event access (not 'all'), check if this event is allowed
                if (!userEventAccess.includes(event.aid)) {
                    return; // Skip this event if not in user's access list
                }
            }

            const subEventKeys = Object.keys(event.subEvents || {});

            if (subEventKeys.length === 0) {
                // Event with no sub-events, treat as single item
                subEvents.push({
                    event,
                    subEventKey: '',
                    subEventData: {},
                    date: '',
                    displayText: event.name,
                    eventKey: `${event.aid}`
                });
            } else {
                // Event with sub-events, create item for each sub-event
                subEventKeys.forEach(subEventKey => {
                    const subEventData = event.subEvents[subEventKey];
                    const date = subEventData?.date || '';
                    const displayText = formatSubEventDisplay(event, subEventKey, subEventData);

                    subEvents.push({
                        event,
                        subEventKey,
                        subEventData,
                        date,
                        displayText,
                        eventKey: `${event.aid}:${subEventKey}`
                    });
                });
            }
        });

        return subEvents;
    };

    // Helper function to get all lists
    const getAllLists = (events: Event[]): SubEventItem[] => {
        const lists: SubEventItem[] = [];

        // Defensive coding: ensure events is an array
        if (!Array.isArray(events)) {
            return lists;
        }

        events.forEach(event => {
            if (event.hide) return; // Skip hidden events
            if (event.list !== true) return; // Only include lists

            // Filter lists based on user's event access list
            if (userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                // If user has specific event access (not 'all'), check if this list is allowed
                if (!userEventAccess.includes(event.aid)) {
                    return; // Skip this list if not in user's access list
                }
            }

            // Lists use the top-level name field, no subevents needed
            const listName = event.name || event.aid;
            lists.push({
                event,
                subEventKey: '',
                subEventData: {},
                date: '',
                displayText: `📋 ${listName}`,
                eventKey: `${event.aid}`
            });
        });

        return lists;
    };

    // Helper function to sort sub-events by date (newest first)
    const sortSubEventsByDate = (subEvents: SubEventItem[]): SubEventItem[] => {
        return [...subEvents].sort((a, b) => {
            if (a.date && b.date) {
                return b.date.localeCompare(a.date); // Newest first
            } else if (a.date) {
                return -1; // Items with dates come first
            } else if (b.date) {
                return 1;
            } else {
                return a.displayText.localeCompare(b.displayText); // Alphabetical for items without dates
            }
        });
    };

    // Event selection components
    const EventSelection = () => {
        const handleEventSelection = async (eventKey: string) => {
            if (!eventKey) return;

            // Parse the event key to get event aid and sub-event key
            const [eventAid, subEventKey] = eventKey.includes(':') ? eventKey.split(':') : [eventKey, ''];

            // Find the event by aid
            const selectedEvent = allEvents.find(e => e.aid === eventAid) || null;
            if (!selectedEvent) return;

            // Abort any current loading operation
            if (currentLoadingAbortControllerRef.current) {
                currentLoadingAbortControllerRef.current.abort();
                console.log('Aborted previous loading operation for event switch');
            }

            // Create new abort controller for this load
            currentLoadingAbortControllerRef.current = new AbortController();

            // Set the current event and sub-event
            const updatedEvent = { ...selectedEvent };

            // For lists, don't set subEvent. For events, set it if provided
            if (updatedEvent.list === true) {
                updatedEvent.selectedSubEvent = '';
            } else if (subEventKey) {
                updatedEvent.selectedSubEvent = subEventKey;
            }

            localStorage.setItem('event', JSON.stringify(updatedEvent));
            setEvShadow(updatedEvent);

            // Set loaded=true BEFORE calling loadStudentsForEvent for lazy loading
            setLoaded(true);

            // Reset accumulated eligible students ref for new event
            accumulatedEligibleStudentsRef.current = [];

            // Reset the "all students loaded" state for the new event
            setAllStudentsLoadedForCurrentEvent(false);

            // For lists, automatically set view to "Eligible"
            if (updatedEvent.list === true) {
                setView('Eligible');
            }

            // Load students for the new event/list using the caching system (now in background)
            loadStudentsForEvent(
                updatedEvent.aid,
                allEvents,
                allPools,
                (eligibleStudents) => {
                    // For lists, use "Eligible" view; for events, use current view or undefined
                    const viewToUse = updatedEvent.list === true ? 'Eligible' : undefined;
                    return updateTableDataIncrementally(eligibleStudents, viewToUse, updatedEvent, allPools);
                },
                currentLoadingAbortControllerRef.current
            ).then(eligibleStudents => {
                setCurrentEligibleStudents(eligibleStudents);

                // Update current user name after loading students for the new event
                fetchCurrentUser(eligibleStudents);

                // Update user's eventDashboardLastUsedConfig with the new selection
                return updateUserEventDashboardLastUsedConfig({
                    event: eventAid,
                    subEvent: updatedEvent.list === true ? undefined : (subEventKey || undefined),
                    view: updatedEvent.list === true ? 'Eligible' : undefined
                });
            }).catch(error => {
                if (error.name === 'AbortError') {
                    console.log('Loading operation was aborted due to event switch');
                } else {
                    console.error('Error loading students or updating data for new event:', error);
                }
            });
            setEventDropdownOpen(false);
            setEventListSearchTerm(''); // Clear search when selection is made
        };

        // Get all sub-events and sort them (filtered by user's event access)
        const allSubEvents = getAllSubEvents(allEvents);
        const sortedSubEvents = sortSubEventsByDate(allSubEvents);

        // Get all lists if user has listAccess
        const allLists = userListAccess ? getAllLists(allEvents) : [];
        const sortedLists = [...allLists].sort((a, b) => 
            a.displayText.localeCompare(b.displayText) // Alphabetical for lists
        );

        // Combine events and lists
        const allItems = [...sortedSubEvents, ...sortedLists];

        // Filter items based on search term
        const filteredItems = eventListSearchTerm.trim() === '' 
            ? allItems 
            : allItems.filter(item => {
                const searchLower = eventListSearchTerm.toLowerCase();
                return item.displayText.toLowerCase().includes(searchLower) ||
                       item.event.aid.toLowerCase().includes(searchLower) ||
                       (item.event.name && item.event.name.toLowerCase().includes(searchLower));
            });

        // Find the current item for the title
        let currentItem: SubEventItem | null = null;
        if (evShadow) {
            if (evShadow.list === true) {
                // For lists, find by aid only
                currentItem = allLists.find(item => item.event.aid === evShadow!.aid) || null;
            } else {
                // For events, find by aid and subEventKey
                const selectedKey = evShadow.selectedSubEvent;
                currentItem = allSubEvents.find(se =>
                    se.event.aid === evShadow!.aid &&
                    (selectedKey ? se.subEventKey === selectedKey : true)
                ) || null;
            }
        }

        const title = currentItem ? currentItem.displayText : "Select Event/List";

        // Calculate the maximum width needed for the dropdown button
        const calculateMaxWidth = () => {
            if (allItems.length === 0) return 'auto';

            // Create a temporary element to measure text width
            const tempElement = document.createElement('span');
            tempElement.style.visibility = 'hidden';
            tempElement.style.position = 'absolute';
            tempElement.style.whiteSpace = 'nowrap';
            tempElement.style.fontSize = '0.9rem';
            tempElement.style.fontWeight = '600';
            tempElement.style.fontFamily = 'inherit';
            document.body.appendChild(tempElement);

            let maxWidth = 0;

            // Measure each dropdown item
            allItems.forEach(item => {
                tempElement.textContent = item.displayText;
                const width = tempElement.offsetWidth;
                maxWidth = Math.max(maxWidth, width);
            });

            // Clean up
            document.body.removeChild(tempElement);

            // Add padding for the dropdown arrow and some buffer
            return `${Math.max(maxWidth + 60, 200)}px`; // Minimum 200px for search input
        };

        const dropdownWidth = calculateMaxWidth();

        // Clear search when dropdown closes
        useEffect(() => {
            if (!eventDropdownOpen) {
                setEventListSearchTerm('');
            }
        }, [eventDropdownOpen]);

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                const target = event.target as Element;
                if (!target.closest('.modern-dropdown')) {
                    setEventDropdownOpen(false);
                }
            };

            if (eventDropdownOpen) {
                document.addEventListener('mousedown', handleClickOutside);
            }

            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }, [eventDropdownOpen]);

        return (
            <div className="modern-dropdown">
                <button
                    type="button"
                    className="dropdown-trigger"
                    style={{ width: dropdownWidth, minWidth: dropdownWidth, position: 'relative' }}
                    onClick={() => {
                        setEventDropdownOpen(!eventDropdownOpen);
                    }}
                >
                    <span className="dropdown-title">{title}</span>
                    <svg
                        className={`dropdown-arrow ${eventDropdownOpen ? 'rotated' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <polyline points="6,9 12,15 18,9" />
                    </svg>

                    {/* Progressive purple overlay that fills the dropdown bubble */}
                    {(loadingEligibilityCache || allStudentsLoadedForCurrentEvent) && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: '8px',
                            overflow: 'hidden',
                            zIndex: 10
                        }}>
                            {/* Progress fill that grows from left to right */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                height: '100%',
                                backgroundColor: 'rgba(139, 69, 219, 0.4)',
                                width: allStudentsLoadedForCurrentEvent
                                    ? '100%'
                                    : loadingProgress.total > 0
                                        ? `${Math.min(100, (loadingProgress.current / loadingProgress.total) * 100)}%`
                                        : '30%',
                                transition: 'width 0.3s ease',
                                animation: loadingProgress.total === 0 && !allStudentsLoadedForCurrentEvent ? 'pulse 1.5s ease-in-out infinite' : 'none'
                            }}></div>
                        </div>
                    )}
                </button>
                {eventDropdownOpen && (
                    <div className="custom-dropdown-menu" style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        width: dropdownWidth,
                        background: '#000000',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                        zIndex: 1000,
                        maxHeight: '400px',
                        display: 'flex',
                        flexDirection: 'column',
                        marginTop: '0.25rem'
                    }}>
                        {/* Search Input - Sticky at top */}
                        <div style={{
                            padding: '8px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                            position: 'sticky',
                            top: 0,
                            background: '#000000',
                            zIndex: 1
                        }}>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    value={eventListSearchTerm}
                                    onChange={(e) => setEventListSearchTerm(e.target.value)}
                                    placeholder="🔍 Search events/lists..."
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        width: '100%',
                                        padding: '8px 32px 8px 12px',
                                        backgroundColor: '#1a1a1a',
                                        color: 'white',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '6px',
                                        fontSize: '0.9rem',
                                        outline: 'none'
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            setEventDropdownOpen(false);
                                        } else if (e.key === 'Enter' && filteredItems.length > 0) {
                                            handleEventSelection(filteredItems[0].eventKey);
                                        }
                                    }}
                                />
                                {eventListSearchTerm && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEventListSearchTerm('');
                                        }}
                                        style={{
                                            position: 'absolute',
                                            right: '8px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'transparent',
                                            border: 'none',
                                            color: '#aaa',
                                            cursor: 'pointer',
                                            fontSize: '18px',
                                            padding: '0 4px',
                                            lineHeight: '1'
                                        }}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Filtered Results - Scrollable */}
                        <div style={{
                            maxHeight: '300px',
                            overflowY: 'auto',
                            overflowX: 'hidden'
                        }}>
                            {filteredItems.length === 0 ? (
                                <div style={{
                                    padding: '16px',
                                    color: '#aaa',
                                    textAlign: 'center',
                                    fontSize: '0.9rem'
                                }}>
                                    No results found
                                </div>
                            ) : (
                                filteredItems.map((item, index) => {
                                    // Add visual divider between events and lists if both are present
                                    const showDivider = userListAccess && 
                                        index > 0 && 
                                        sortedSubEvents.length > 0 && 
                                        sortedLists.length > 0 &&
                                        item.event.list === true && 
                                        filteredItems[index - 1].event.list !== true;

                                    return (
                                        <React.Fragment key={item.eventKey}>
                                            {showDivider && (
                                                <div style={{
                                                    padding: '4px 12px',
                                                    fontSize: '0.75rem',
                                                    color: '#666',
                                                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                                                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                                    backgroundColor: '#111'
                                                }}>
                                                    Lists
                                                </div>
                                            )}
                                            <button
                                                className="dropdown-item"
                                                style={{ color: 'white' }}
                                                onClick={() => handleEventSelection(item.eventKey)}
                                            >
                                                {item.displayText}
                                            </button>
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const ViewSelection = () => {
        const handleViewSelection = async (viewName: string | null) => {
            if (!viewName) {
                return;
            }
            setView(viewName);

            // Update user's eventDashboardLastUsedConfig with the new view selection
            try {
                await updateUserEventDashboardLastUsedConfig({
                    view: viewName
                });
            } catch (error) {
                console.error('Error updating user eventDashboardLastUsedConfig:', error);
            }

            try {
                const [cl, rd] = await assembleColumnLabelsAndRowData(viewName, month, year);
                setColumnLabels(cl);
                setRowData(rd);
            } catch (error) {
                console.error('[VIEW SELECTION DEBUG] Error in assembleColumnLabelsAndRowData', { viewName, error });
            }
            setViewDropdownOpen(false);
        };

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                const target = event.target as Element;
                if (!target.closest('.modern-dropdown')) {
                    setViewDropdownOpen(false);
                }
            };

            if (viewDropdownOpen) {
                document.addEventListener('mousedown', handleClickOutside);
            }

            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }, [viewDropdownOpen]);

        return (
            <div className="modern-dropdown">
                <button
                    type="button"
                    className="dropdown-trigger"
                    onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
                >
                    <span className="dropdown-title">{view || "Select View"}</span>
                    <svg
                        className={`dropdown-arrow ${viewDropdownOpen ? 'rotated' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <polyline points="6,9 12,15 18,9" />
                    </svg>
                </button>
                {viewDropdownOpen && (
                    <div className="custom-dropdown-menu" style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: '#000000',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                        zIndex: 1000,
                        maxHeight: '300px',
                        overflowY: 'auto',
                        marginTop: '0.25rem'
                    }}>
                        {views.map((viewName) => (
                            <button
                                key={viewName}
                                className="dropdown-item"
                                style={{ color: 'white' }}
                                onClick={() => handleViewSelection(viewName)}
                            >
                                {viewName}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };





    // Add this helper function above assembleColumnLabelsAndRowData
    function studentMatchesViewConditions(
        student: Student,
        conditions: any[],
        currentEvent: Event,
        allPools: Pool[]
    ): boolean {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            return true;
        }

        const eventRecordForStudent = student.programs?.[currentEvent.aid] || {};

        for (const cond of conditions) {
            if (cond.name === 'currentAIDBool') {
                const boolVal = cond.boolName ? eventRecordForStudent[cond.boolName] : undefined;
                const result = (boolVal ?? false) === cond.boolValue;
                if (!result) return false;
            } else if (cond.name === 'currentAIDMapBool') {
                const mapKey = cond.map as string | undefined;
                const boolKey = cond.boolName as string | undefined;
                const map = mapKey ? eventRecordForStudent[mapKey] : undefined;
                const boolVal = (map && boolKey) ? map[boolKey] : undefined;
                const result = (boolVal ?? false) === cond.boolValue;
                if (!result) return false;
            } else if (cond.name === 'baseBool') {
                const boolKey = cond.boolName as string | undefined;
                const boolVal = boolKey ? (student as any)[boolKey] : undefined;
                let result;
                if (typeof boolVal !== 'undefined') {
                    result = boolVal === cond.boolValue;
                } else {
                    result = !cond.boolValue;
                }
                if (!result) return false;
            } else if (cond.name === 'practiceBool') {
                const boolKey = cond.boolName as string | undefined;
                const boolVal = boolKey ? student.practice?.[boolKey] : undefined;
                let result;
                if (typeof boolVal !== 'undefined') {
                    result = boolVal === cond.boolValue;
                } else {
                    result = !cond.boolValue;
                }
                if (!result) return false;
            } else if (cond.name === 'poolMember') {
                let result = true;
                if (typeof checkEligibility !== 'undefined') {
                    result = checkEligibility(cond.pool, student, currentEvent.aid, allPools);
                }
                if (!result) return false;
            } else if (cond.name === 'offering' || cond.name === 'deposit') {
                let installmentTotal = 0;
                let installmentReceived = 0;
                const subEventKey = currentEvent.selectedSubEvent as string | undefined;

                if (eventRecordForStudent.offeringHistory && subEventKey && eventRecordForStudent.offeringHistory[subEventKey]) {
                    if (currentEvent.config?.offeringPresentation !== 'installments') {
                        if (!cond.boolValue) return false;
                    } else {
                        let limitCount = 100;
                        let count = 0;
                        if (eventRecordForStudent.limitFee) limitCount = 2;
                        if (eventRecordForStudent.whichRetreats && currentEvent.config?.whichRetreatsConfig) {
                            for (const [retreat, value] of Object.entries(eventRecordForStudent.whichRetreats)) {
                                if (value && currentEvent.config.whichRetreatsConfig[retreat]) {
                                    installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal;
                                    count += 1;
                                    if (count >= limitCount) break;
                                }
                            }
                        }
                        const installments = eventRecordForStudent.offeringHistory[subEventKey]?.installments || {};
                        for (const installmentEntry of Object.values<any>(installments)) {
                            installmentReceived += installmentEntry.offeringAmount || 0;
                        }
                        if (installmentReceived === 0) {
                            if (cond.boolValue) {
                                return false;
                            }
                        } else {
                            if (cond.name === 'deposit') {
                                if (!cond.boolValue) {
                                    return false;
                                }
                            } else {
                                if (installmentReceived >= installmentTotal) {
                                    if (!cond.boolValue) {
                                        return false;
                                    }
                                } else {
                                    if (cond.boolValue) {
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    if (cond.boolValue) return false;
                }
            } else if (cond.name === 'spokenLanguage') {
                const spokenLanguage = student.spokenLangPref ?? 'English';
                const stringValue = typeof cond.stringValue === 'string' ? cond.stringValue : '';
                const match = stringValue === spokenLanguage;
                const result = cond.boolValue ? match : !match;
                if (!result) return false;
            } else if (cond.name === 'writtenLanguage') {
                let writtenLanguage = '';
                if (student.spokenTranslate && student.writtenLangPref && student.writtenLangPref !== 'English') {
                    writtenLanguage = student.writtenLangPref;
                }
                if (writtenLanguage === '') writtenLanguage = 'English';
                const stringValue = typeof cond.stringValue === 'string' ? cond.stringValue : '';
                const match = stringValue === writtenLanguage;
                const result = cond.boolValue ? match : !match;
                if (!result) return false;
            }
        }

        return true;
    }

    // Add this helper above assembleColumnLabelsAndRowData
    interface ColumnMetaData {
        [key: string]: any;
    }

    function buildColumnLabelsAndMetaData(
        columnDefs: Array<any>,
        predefined: Record<string, any>
    ): { columns: Column[]; columnMetaData: ColumnMetaData } {
        const specials: Record<string, Partial<Column>> = {
            'bool': { cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
            'string': { sortable: true },
            'number': { sortable: true, width: 100 }
        };
        const columns: Column[] = [];
        const columnMetaData: ColumnMetaData = {};
        for (const colDef of columnDefs) {
            const defName = colDef.name;
            let obj: Column;
            // poolMember
            if (defName.includes('poolMember')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { pool: colDef.pool };
            } else if (defName.includes('currentAIDBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { boolName: colDef.boolName };
            } else if (defName.includes('specifiedAIDBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { aid: colDef.aid, boolName: colDef.boolName };
            } else if (defName.includes('currentAIDMapBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { map: colDef.map, boolName: colDef.boolName };
            } else if (defName.includes('currentAIDMapList')) {
                obj = { ...specials['string'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { map: colDef.map };
            } else if (defName.includes('specifiedAIDMapBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { aid: colDef.aid, map: colDef.map, boolName: colDef.boolName };
            } else if (defName.includes('currentAIDString')) {
                obj = { ...specials['string'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { stringName: colDef.stringName };
            } else if (defName.includes('specifiedAIDString')) {
                obj = { ...specials['string'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { aid: colDef.aid, stringName: colDef.stringName };
            } else if (defName.includes('currentAIDNumber')) {
                obj = { ...specials['number'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { numberName: colDef.numberName };
            } else if (defName.includes('specifiedAIDNumber')) {
                obj = { ...specials['number'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { aid: colDef.aid, numberName: colDef.numberName };
            } else if (defName.includes('baseBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { boolName: colDef.boolName };
            } else if (defName.includes('baseString')) {
                obj = { ...specials['string'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { stringName: colDef.stringName };
            } else if (defName.includes('practiceBool')) {
                obj = { ...specials['bool'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { boolName: colDef.boolName };
            } else if (defName.includes('offeringCount')) {
                obj = { ...specials['number'], field: defName, headerName: colDef.headerName };
                columnMetaData[defName] = { aid: colDef.aid };
            } else {
                // Predefined columns
                if (typeof predefined[defName] === 'undefined') {
                    console.warn('UNKNOWN column definition:', defName);
                    obj = { field: defName, headerName: `unknown: ${defName}` };
                } else {
                    obj = predefined[defName];
                }
            }
            // Inherit writeEnabled from colDef if present (for all custom columns)
            if (typeof colDef.writeEnabled !== 'undefined') {
                obj.writeEnabled = colDef.writeEnabled;
            }
            // Validate column object before adding
            if (obj && obj.field && obj.field.trim() !== '') {
                columns.push(obj);
            } else {
                console.warn('Skipping invalid column definition:', colDef, 'obj:', obj);
            }
        }

        // Always add hidden id and history columns if not already present
        const existingFields = new Set(columns.map(col => col.field));
        if (predefined['id'] && !existingFields.has('id')) columns.push(predefined['id']);
        if (predefined['history'] && !existingFields.has('history')) columns.push(predefined['history']);

        return { columns, columnMetaData };
    }

    // Add this helper above assembleColumnLabelsAndRowData
    function getRowValuesForStudent(
        student: Student,
        columnLabels: Column[],
        columnMetaData: Record<string, any>,
        currentEvent: Event,
        allPools: Pool[],
        emailDisplayValue: boolean = emailDisplayPermission
    ): Record<string, any> | null {
        const rowValues: Record<string, any> = {};
        for (let i = 0; i < columnLabels.length; i++) {
            const col = columnLabels[i];
            const field = col.field;
            try {
                if (field === 'rowIndex') {
                    // Row index will be handled by DataTable component
                    rowValues[field] = undefined;
                } else if (field === 'id') {
                    rowValues[field] = student.id;
                } else if (field === 'name') {
                    rowValues[field] = `${student.first} ${student.last}`;
                } else if (field === 'first') {
                    rowValues[field] = student.first;
                } else if (field === 'last') {
                    rowValues[field] = student.last;
                } else if (field === 'email') {
                    rowValues[field] = maskEmail(student.email, emailDisplayValue);
                } else if (field === 'joined') {
                    rowValues[field] = (typeof currentEvent.aid === 'string' && student.programs?.[currentEvent.aid]) ? student.programs[currentEvent.aid].join ?? false : false;
                } else if (field === 'accepted') {
                    rowValues[field] = (typeof currentEvent.aid === 'string' && student.programs?.[currentEvent.aid]) ? student.programs[currentEvent.aid].accepted ?? false : false;
                } else if (field === 'allow') {
                    rowValues[field] = (typeof currentEvent.aid === 'string' && student.programs?.[currentEvent.aid]) ? student.programs[currentEvent.aid].allow ?? false : false;
                } else if (field === 'withdrawn') {
                    rowValues[field] = (typeof currentEvent.aid === 'string' && student.programs?.[currentEvent.aid]) ? student.programs[currentEvent.aid].withdrawn ?? false : false;
                } else if (field.includes('offeringCount')) {
                    const aid = columnMetaData[field]?.aid as string | undefined;
                    const offeringHistory = aid ? student.programs?.[aid]?.offeringHistory : undefined;
                    rowValues[field] = offeringHistory ? Object.keys(offeringHistory).length : 0;
                } else if (field.includes('poolMember')) {
                    rowValues[field] = typeof checkEligibility !== 'undefined' ? checkEligibility(columnMetaData[field]?.pool, student, currentEvent.aid, allPools) : false;
                } else if (field.includes('emailSent')) {
                    rowValues[field] = student.emails?.[columnMetaData[field]?.campaign as string] ?? '';
                } else if (field.includes('currentAIDBool')) {
                    const boolName = columnMetaData[field]?.boolName;
                    rowValues[field] = typeof boolName === 'string' && student.programs?.[currentEvent.aid] ? student.programs[currentEvent.aid][boolName] ?? false : false;
                } else if (field.includes('specifiedAIDBool')) {
                    const aid = columnMetaData[field]?.aid;
                    const boolName = columnMetaData[field]?.boolName;
                    if (typeof aid === 'string' && typeof boolName === 'string' && student.programs?.[aid]) {
                        rowValues[field] = student.programs[aid][boolName] ?? false;
                    } else {
                        rowValues[field] = false;
                    }
                } else if (field.includes('currentAIDMapBool')) {
                    const map = columnMetaData[field]?.map;
                    const boolName = columnMetaData[field]?.boolName;
                    if (
                        typeof map === 'string' &&
                        typeof boolName === 'string' &&
                        student.programs &&
                        typeof currentEvent.aid === 'string' &&
                        student.programs[currentEvent.aid] &&
                        student.programs[currentEvent.aid][map] &&
                        typeof student.programs[currentEvent.aid][map] === 'object'
                    ) {
                        rowValues[field] = student.programs[currentEvent.aid][map][boolName] ?? false;
                    } else {
                        rowValues[field] = false;
                    }
                } else if (field.includes('currentAIDMapList')) {
                    let listString = '';
                    const mapKey = columnMetaData[field]?.map;
                    if (
                        typeof mapKey === 'string' &&
                        student.programs &&
                        typeof currentEvent.aid === 'string' &&
                        student.programs[currentEvent.aid] &&
                        student.programs[currentEvent.aid][mapKey] &&
                        typeof student.programs[currentEvent.aid][mapKey] === 'object'
                    ) {
                        const mapObj = student.programs[currentEvent.aid][mapKey];
                        for (const [name, value] of Object.entries(mapObj)) {
                            if (value) listString += name + ' ';
                        }
                    }
                    rowValues[field] = listString.trim();
                } else if (field.includes('specifiedAIDMapBool')) {
                    const aid = columnMetaData[field]?.aid;
                    const map = columnMetaData[field]?.map;
                    const boolName = columnMetaData[field]?.boolName;
                    if (
                        typeof aid === 'string' &&
                        typeof map === 'string' &&
                        typeof boolName === 'string' &&
                        student.programs &&
                        student.programs[aid] &&
                        student.programs[aid][map] &&
                        typeof student.programs[aid][map] === 'object'
                    ) {
                        rowValues[field] = student.programs[aid][map][boolName] ?? false;
                    } else {
                        rowValues[field] = false;
                    }
                } else if (field.includes('currentAIDString')) {
                    const stringName = columnMetaData[field]?.stringName;
                    rowValues[field] = typeof stringName === 'string' && student.programs?.[currentEvent.aid] ? student.programs[currentEvent.aid][stringName] ?? 'unknown' : 'unknown';
                } else if (field.includes('currentAIDNumber')) {
                    const numberName = columnMetaData[field]?.numberName;
                    rowValues[field] = typeof numberName === 'string' && student.programs?.[currentEvent.aid] ? student.programs[currentEvent.aid][numberName] ?? 'unknown' : 'unknown';
                } else if (field.includes('baseString')) {
                    const stringName = columnMetaData[field]?.stringName;
                    rowValues[field] = typeof stringName === 'string' ? (student as any)[stringName] ?? 'unknown' : 'unknown';
                } else if (field.includes('baseBool')) {
                    const boolName = columnMetaData[field]?.boolName;
                    rowValues[field] = typeof boolName === 'string' ? (student as any)[boolName] ?? 'unknown' : 'unknown';
                } else if (field.includes('practiceBool')) {
                    const boolName = columnMetaData[field]?.boolName;
                    rowValues[field] = typeof boolName === 'string' ? student.practice?.[boolName] ?? 'unknown' : 'unknown';
                } else if (field === 'emailRegSent') {
                    const key = `${currentEvent.aid}_${currentEvent.selectedSubEvent}_reg_EN`;
                    rowValues[field] = student.emails?.[key]?.substring(0, 10) ?? '';
                } else if (field === 'emailAcceptSent') {
                    const key = `${currentEvent.aid}_${currentEvent.selectedSubEvent}_accept_EN`;
                    rowValues[field] = student.emails?.[key]?.substring(0, 10) ?? '';
                } else if (field === 'emailZoomSent') {
                    const key = `${currentEvent.aid}_${currentEvent.selectedSubEvent}_reg_confirm_EN`;
                    rowValues[field] = student.emails?.[key]?.substring(0, 10) ?? '';
                } else if (field === 'owyaa') {
                    // Calculate OWYAA days left
                    const diffTime = (_datetime: string) => {
                        const datetime = new Date(_datetime).getTime();
                        const now = new Date().getTime();
                        if (isNaN(datetime)) return 9999;
                        return Math.floor(Math.abs(now - datetime) / 1000 / 60 / (60 * 24));
                    };
                    let owyaaDays = -1;
                    if (typeof student.owyaaLease !== 'undefined') {
                        owyaaDays = diffTime(student.owyaaLease);
                    }
                    let owyaaText;
                    if (owyaaDays !== -1) {
                        if (owyaaDays > 90) owyaaDays = 90;
                        owyaaText = `OWYAA Days Left: ${90 - owyaaDays}`;
                    } else {
                        owyaaText = 'Enable OWYAA';
                    }
                    rowValues[field] = owyaaText;
                } else if (field === 'offering' || field === 'deposit') {
                    const aid = typeof currentEvent.aid === 'string' ? currentEvent.aid : undefined;
                    const selectedSubEvent = typeof currentEvent.selectedSubEvent === 'string' ? currentEvent.selectedSubEvent : undefined;
                    const person = aid ? student.programs?.[aid] : undefined;
                    let offering = false;
                    let offeringDate = '';
                    let installmentTotal = 0;
                    let installmentReceived = 0;
                    if (person && person.offeringHistory && selectedSubEvent && person.offeringHistory[selectedSubEvent]) {
                        if (currentEvent.config?.offeringPresentation !== 'installments') {
                            offering = true;
                            offeringDate = person.offeringHistory[selectedSubEvent]?.offeringTime?.substring(0, 10) ?? '';
                        } else {
                            let limitCount = 100;
                            let count = 0;
                            if (person.limitFee) limitCount = 2;
                            if (person.whichRetreats && currentEvent.config?.whichRetreatsConfig) {
                                for (const [retreat, value] of Object.entries(person.whichRetreats)) {
                                    if (value && currentEvent.config.whichRetreatsConfig[retreat]) {
                                        installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal;
                                        count += 1;
                                        if (count >= limitCount) break;
                                    }
                                }
                            }
                            let lastOfferingTime = '';
                            const installments = person.offeringHistory[selectedSubEvent]?.installments || {};
                            for (const [installmentName, installmentEntry] of Object.entries<any>(installments)) {
                                if (installmentName !== 'refunded') {
                                    installmentReceived += installmentEntry.offeringAmount;
                                    lastOfferingTime = installmentEntry.offeringTime;
                                }
                            }
                            if (installmentReceived === 0) {
                                offering = false;
                            } else {
                                if (field === 'deposit') {
                                    offering = true;
                                    offeringDate = lastOfferingTime?.substring(0, 10) ?? '';
                                } else {
                                    if (installmentReceived >= installmentTotal) {
                                        offering = true;
                                        offeringDate = lastOfferingTime?.substring(0, 10) ?? '';
                                    } else {
                                        offering = false;
                                    }
                                }
                            }
                        }
                    }
                    rowValues[field] = offeringDate;
                } else if (field === 'installmentsTotal' || field === 'installmentsReceived' || field === 'installmentsDue' || field === 'installmentsRefunded') {
                    // Return "N/A" if offering presentation is not installments
                    if (currentEvent.config?.offeringPresentation !== 'installments') {
                        rowValues[field] = 'N/A';
                    } else {
                        const aid = typeof currentEvent.aid === 'string' ? currentEvent.aid : undefined;
                        const selectedSubEvent = typeof currentEvent.selectedSubEvent === 'string' ? currentEvent.selectedSubEvent : undefined;
                        const person = aid ? student.programs?.[aid] : undefined;
                        let installmentTotal = 0;
                        let installmentReceived = 0;
                        let installmentRefunded = 0;
                        
                        if (person) {
                            // Calculate total from whichRetreats and whichRetreatsConfig
                            let limitCount = 100;
                            let count = 0;
                            if (person.limitFee) limitCount = 2;
                            if (person.whichRetreats && currentEvent.config?.whichRetreatsConfig) {
                                for (const [retreat, value] of Object.entries(person.whichRetreats)) {
                                    if (value && currentEvent.config.whichRetreatsConfig[retreat]) {
                                        installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal;
                                        count += 1;
                                        if (count >= limitCount) break;
                                    }
                                }
                            }
                            
                            // Calculate received and refunded from installments
                            if (selectedSubEvent && person.offeringHistory?.[selectedSubEvent]?.installments) {
                                const installments = person.offeringHistory[selectedSubEvent].installments;
                                for (const [installmentName, installmentEntry] of Object.entries<any>(installments)) {
                                    if (installmentName === 'refunded') {
                                        installmentRefunded += installmentEntry.offeringAmount || 0;
                                    } else {
                                        installmentReceived += installmentEntry.offeringAmount || 0;
                                    }
                                }
                            }
                        }
                        
                        if (field === 'installmentsTotal') {
                            rowValues[field] = installmentTotal;
                        } else if (field === 'installmentsReceived') {
                            rowValues[field] = installmentReceived;
                        } else if (field === 'installmentsDue') {
                            rowValues[field] = installmentTotal - installmentReceived;
                        } else if (field === 'installmentsRefunded') {
                            rowValues[field] = installmentRefunded;
                        }
                    }
                } else if (field === 'spokenLanguage') {
                    rowValues[field] = student.spokenLangPref ?? student.writtenLangPref ?? '';
                } else if (field === 'writtenLanguage') {
                    rowValues[field] = student.writtenLangPref ?? '';
                } else {
                    rowValues[field] = (student as any)[field] ?? '';
                }
            } catch {
                rowValues[field] = '';
            }
        }
        return rowValues;
    }

    // Helper function to update table data incrementally
    const updateTableDataIncrementally = async (eligibleStudents: Student[], viewName?: string, currentEvent?: Event, currentPools?: Pool[]) => {
        console.log('updateTableDataIncrementally called with:', {
            eligibleStudentsCount: eligibleStudents?.length,
            viewName,
            evShadow: !!evShadow,
            currentEvent: !!currentEvent,
            allStudentsCount: allStudents?.length,
            allPoolsCount: allPools?.length,
            currentPoolsCount: currentPools?.length
        });

        const eventToUse = currentEvent || evShadow;
        if (!eventToUse) {
            console.log('No event available, returning early');
            return;
        }

        const poolsToUse = currentPools || allPools;
        if (!poolsToUse || poolsToUse.length === 0) {
            console.log('No pools available, returning early');
            return;
        }

        const currentView = viewName || view || 'Joined';
        console.log('Using currentView:', currentView);

        try {
            // Accumulate eligible students from all batches using ref
            const allEligibleStudents = [...accumulatedEligibleStudentsRef.current, ...eligibleStudents];
            console.log('Accumulated eligible students:', {
                previousCount: accumulatedEligibleStudentsRef.current.length,
                newBatchCount: eligibleStudents?.length || 0,
                totalCount: allEligibleStudents.length
            });

            // Update the ref with accumulated data
            accumulatedEligibleStudentsRef.current = allEligibleStudents;

            // Use all accumulated eligible students instead of just the current batch
            const [cl, rd] = await assembleColumnLabelsAndRowDataWithData(
                currentView,
                month,
                year,
                eventToUse,
                allStudents,
                poolsToUse,
                allEligibleStudents
            );
            console.log('Table data assembled:', { columnsCount: cl?.length, rowsCount: rd?.length });
            setColumnLabels(cl);
            setRowData(rd);
            setCurrentEligibleStudents(allEligibleStudents);
        } catch (error) {
            console.error('Error updating table data incrementally:', error);
        }
    };

    // Add this helper at the top or near the merge logic
    // function deepMerge(target: any, source: any): any {
    //     if (typeof target !== 'object' || typeof source !== 'object' || target === null || source === null) {
    //         return source;
    //     }
    //     const result = { ...target };
    //     for (const key of Object.keys(source)) {
    //         if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
    //             result[key] = deepMerge(target[key], source[key]);
    //         } else {
    //             result[key] = source[key];
    //         }
    //     }
    //     return result;
    // }

    // 2. Update assembleColumnLabelsAndRowData to:
    //    - Always check config.dashboardViews for translation
    //    - Display error if view is missing (no fallback columns)
    //    - Always apply view conditions after eligibility and search
    const assembleColumnLabelsAndRowData = async (viewName: string, monthValue: string, yearValue: string) => {
        console.log('assembleColumnLabelsAndRowData called with:', { viewName, monthValue, yearValue });
        console.log('Current state - evShadow:', evShadow);
        console.log('Current state - allStudents length:', allStudents.length);
        console.log('Current state - allPools length:', allPools.length);

        setViewError(null); // Reset error
        let effectiveViewName = viewName;
        // Check for translation in currentEvent.config.dashboardViews
        if (evShadow && evShadow.config && evShadow.config.dashboardViews) {
            const translation = evShadow.config.dashboardViews[viewName];
            if (translation) {
                effectiveViewName = translation;
            }
            // If no translation, just use the original viewName (do not show error)
        }

        // Fetch the view definition
        const viewConfig = await fetchView(effectiveViewName);
        console.log('View config:', viewConfig);
        if (!viewConfig || !viewConfig.columnDefs) {
            setViewError(`View '${effectiveViewName}' not found`);
            return [[], []];
        }
        // Define the predefined columns (mimic g_predefinedColumnDefinitions)
        const predefinedColumnDefinitions: Record<string, Column> = {
            'rowIndex': { field: 'rowIndex', headerName: '#', pinned: 'left', width: 75 },
            'name': { field: 'name', pinned: 'left', sortable: true },
            'first': { field: 'first', pinned: 'left', sortable: true },
            'last': { field: 'last', pinned: 'left', sortable: true },
            'spokenLanguage': { field: 'spokenLanguage', sortable: true },
            'writtenLanguage': { field: 'writtenLanguage', sortable: true },
            'accepted': { field: 'accepted', headerName: 'Accept', cellRenderer: 'checkboxRenderer', sortable: true, width: 85, writeEnabled: true },
            'allow': { field: 'allow', headerName: 'Allow', cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
            'joined': { field: 'joined', headerName: 'Joined', cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
            'withdrawn': { field: 'withdrawn', headerName: 'Withdrawn', cellRenderer: 'checkboxRenderer', sortable: true, width: 85, writeEnabled: true },
            'email': { field: 'email', headerName: 'Email', sortable: true, width: 200 },
            'notes': { field: 'notes', editable: true },
            'id': { field: 'id', hide: true },
            'history': { field: 'history', hide: true },
            'emailRegSent': { field: 'emailRegSent', headerName: 'Reg email', width: 120, sortable: true },
            'emailAcceptSent': { field: 'emailAcceptSent', headerName: 'Accept email', width: 120, sortable: true },
            'emailZoomSent': { field: 'emailZoomSent', headerName: 'Zoom email', width: 120, sortable: true },
            'owyaa': { field: 'owyaa', writeEnabled: true },
            'attended': { field: 'attended', cellRenderer: 'checkboxRenderer', sortable: true },
            'deposit': { field: 'deposit', cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
            'offering': { field: 'offering', sortable: true, width: 120 },
            'installmentsTotal': { field: 'installmentsTotal', headerName: 'Total', sortable: true, width: 125 },
            'installmentsReceived': { field: 'installmentsReceived', headerName: 'Received', sortable: true, width: 125 },
            'installmentsDue': { field: 'installmentsDue', headerName: 'Balance', sortable: true, width: 125 },
            'installmentsRefunded': { field: 'installmentsRefunded', headerName: 'Refunded', sortable: true, width: 125 },
            'installmentsLF': { field: 'installmentsLF', headerName: 'LF', cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }
        };
        // Use the helper:
        const { columns: columnLabels, columnMetaData: newColumnMetaData } = buildColumnLabelsAndMetaData(viewConfig.columnDefs, predefinedColumnDefinitions);
        columnMetaData = newColumnMetaData;

        // Debug: Log the column definitions to see what's being generated
        const conditions = (viewConfig as any).viewConditions || viewConfig.conditions || [];
        setCurrentViewConditions(conditions);

        // Use cached eligible students instead of recalculating

        // Filter students: view conditions, then search (eligibility already handled)
        const filteredStudents = currentEligibleStudents.filter(student => {
            if (!evShadow) {
                return false;
            }

            const conditionsResult = studentMatchesViewConditions(student, conditions, evShadow, allPools);
            if (!conditionsResult) {
                return false;
            }
            // Apply search filter - case insensitive partial match on name field
            if (searchTerm && searchTerm.trim()) {
                const searchLower = searchTerm.toLowerCase().trim();
                const fullName = `${student.first} ${student.last}`.toLowerCase();
                const matches = fullName.includes(searchLower);
                if (!matches) {
                    return false;
                }
            }
            return true;
        });

        console.log('assembleColumnLabelsAndRowDataWithData - filteredStudents:', {
            filteredStudentsCount: filteredStudents.length,
            conditionsCount: conditions.length,
            searchTerm: searchTerm
        });

        const rowValues: any[] = [];
        if (evShadow) {
            for (const student of filteredStudents) {
                const row = getRowValuesForStudent(student, columnLabels, columnMetaData, evShadow, allPools, emailDisplayPermission);
                if (row !== null) {
                    rowValues.push(row);
                }
            }
        }
        setItemCount(rowValues.length);
        return [columnLabels, rowValues];
    };

    const assembleColumnLabelsAndRowDataWithData = async (
        viewName: string,
        monthValue: string,
        yearValue: string,
        currentEvent: Event,
        students: Student[],
        pools: Pool[],
        eligibleStudents?: Student[]
    ) => {
        setViewError(null); // Reset error
        let effectiveViewName = viewName;
        // Check for translation in currentEvent.config.dashboardViews
        if (currentEvent && currentEvent.config && currentEvent.config.dashboardViews) {
            const translation = currentEvent.config.dashboardViews[viewName];
            if (translation) {
                effectiveViewName = translation;
            }
        }

        // Fetch the view definition
        const viewConfig = await fetchView(effectiveViewName);
        console.log('View config:', viewConfig);
        if (!viewConfig || !viewConfig.columnDefs) {
            setViewError(`View '${effectiveViewName}' not found`);
            return [[], []];
        }

        // Define the predefined columns (mimic g_predefinedColumnDefinitions)
        const predefinedColumnDefinitions: Record<string, Column> = {
            'rowIndex': { field: 'rowIndex', headerName: '#', pinned: 'left', width: 75 },
            'name': { field: 'name', pinned: 'left', sortable: true },
            'first': { field: 'first', pinned: 'left', sortable: true },
            'last': { field: 'last', pinned: 'left', sortable: true },
            'spokenLanguage': { field: 'spokenLanguage', sortable: true },
            'writtenLanguage': { field: 'writtenLanguage', sortable: true },
            'accepted': { field: 'accepted', headerName: 'Accept', cellRenderer: 'checkboxRenderer', sortable: true, width: 85, writeEnabled: true },
            'allow': { field: 'allow', headerName: 'Allow', cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
            'joined': { field: 'joined', headerName: 'Joined', cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
            'withdrawn': { field: 'withdrawn', headerName: 'Withdrawn', cellRenderer: 'checkboxRenderer', sortable: true, width: 85, writeEnabled: true },
            'email': { field: 'email', headerName: 'Email', sortable: true, width: 200 },
            'notes': { field: 'notes', editable: true },
            'id': { field: 'id', hide: true },
            'history': { field: 'history', hide: true },
            'emailRegSent': { field: 'emailRegSent', headerName: 'Reg email', width: 120, sortable: true },
            'emailAcceptSent': { field: 'emailAcceptSent', headerName: 'Accept email', width: 120, sortable: true },
            'emailZoomSent': { field: 'emailZoomSent', headerName: 'Zoom email', width: 120, sortable: true },
            'owyaa': { field: 'owyaa', writeEnabled: true },
            'attended': { field: 'attended', cellRenderer: 'checkboxRenderer', sortable: true },
            'deposit': { field: 'deposit', cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
            'offering': { field: 'offering', sortable: true, width: 120 },
            'installmentsTotal': { field: 'installmentsTotal', headerName: 'Total', sortable: true, width: 125 },
            'installmentsReceived': { field: 'installmentsReceived', headerName: 'Received', sortable: true, width: 125 },
            'installmentsDue': { field: 'installmentsDue', headerName: 'Balance', sortable: true, width: 125 },
            'installmentsRefunded': { field: 'installmentsRefunded', headerName: 'Refunded', sortable: true, width: 125 },
            'installmentsLF': { field: 'installmentsLF', headerName: 'LF', cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }
        };

        // Use the helper:
        const { columns: columnLabels, columnMetaData: newColumnMetaData } = buildColumnLabelsAndMetaData(viewConfig.columnDefs, predefinedColumnDefinitions);
        columnMetaData = newColumnMetaData;

        // Debug: Log the column definitions to see what's being generated
        const conditions = (viewConfig as any).viewConditions || viewConfig.conditions || [];
        setCurrentViewConditions(conditions);

        // Use passed eligible students or cached eligible students
        const studentsToUse = eligibleStudents !== undefined ? eligibleStudents : currentEligibleStudents;
        console.log('assembleColumnLabelsAndRowDataWithData - studentsToUse:', {
            eligibleStudentsCount: eligibleStudents?.length,
            currentEligibleStudentsCount: currentEligibleStudents?.length,
            studentsToUseCount: studentsToUse?.length
        });

        // Filter students: view conditions, then search (eligibility already handled)
        const filteredStudents = (studentsToUse || []).filter(student => {
            if (!currentEvent) {
                return false;
            }

            const conditionsResult = studentMatchesViewConditions(student, conditions, currentEvent, pools);
            if (!conditionsResult) {
                return false;
            }
            // Apply search filter - case insensitive partial match on name field
            if (searchTerm && searchTerm.trim()) {
                const searchLower = searchTerm.toLowerCase().trim();
                const fullName = `${student.first} ${student.last}`.toLowerCase();
                const matches = fullName.includes(searchLower);
                if (!matches) {
                    return false;
                }
            }
            return true;
        });

        const rowValues: any[] = [];
        if (currentEvent) {
            for (const student of filteredStudents) {
                const row = getRowValuesForStudent(student, columnLabels, columnMetaData, currentEvent, pools, emailDisplayPermission);
                if (row !== null) {
                    rowValues.push(row);
                }
            }
        }
        console.log('assembleColumnLabelsAndRowDataWithData - final result:', {
            rowValuesCount: rowValues.length,
            columnLabelsCount: columnLabels.length
        });
        setItemCount(rowValues.length);
        return [columnLabels, rowValues];
    };

    // Main initialization effect
    useEffect(() => {
        if (!router.isReady || !pid || !hash) return;
        if (initialLoadStarted.current) return;

        // Clear view cache when hash changes (new authentication session)
        clearViewCache();
        initialLoadStarted.current = true;

        const loadInitialData = async () => {
            try {
                console.log('Starting initial data load, demoMode initial value:', demoMode);

                // Fetch write permission
                const writePermission = await authGetConfigValue(pid as string, hash as string, 'writePermission');
                setCanWriteViews(writePermission === true);
                // Fetch export CSV permission
                const exportCSV = await authGetConfigValue(pid as string, hash as string, 'exportCSV');
                setCanExportCSV(exportCSV === true);
                // Fetch student history permission
                const historyPermission = await authGetConfigValue(pid as string, hash as string, 'studentHistory');
                setCanViewStudentHistory(historyPermission === true);
                // Fetch cache refresh permission
                const refreshPermission = await authGetConfigValue(pid as string, hash as string, 'cacheRefreshPermission');
                setCanRefreshCache(refreshPermission === true);

                // Fetch user's event access list
                try {
                    const eventAccessResult = await authGetConfigValue(pid as string, hash as string, 'eventAccess');
                    if (Array.isArray(eventAccessResult)) {
                        setUserEventAccess(eventAccessResult);
                        console.log('User event access:', eventAccessResult);
                    } else {
                        console.log('No event access restrictions found, showing no events');
                        setUserEventAccess([]); // Default to no events if no restrictions
                    }
                } catch (error) {
                    // Handle AUTH_UNKNOWN_CONFIG_KEY and other errors gracefully
                    if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                        console.log('Event access not configured for user, showing no events');
                    } else {
                        console.error('Error fetching event access:', error);
                    }
                    setUserEventAccess([]); // Default to no events on error or missing config
                }

                // Fetch list access permission
                try {
                    const listAccessResult = await authGetConfigValue(pid as string, hash as string, 'listAccess');
                    if (listAccessResult === true) {
                        setUserListAccess(true);
                        console.log('User has list access');
                    } else {
                        setUserListAccess(false);
                        console.log('User does not have list access');
                    }
                } catch (error) {
                    // Handle AUTH_UNKNOWN_CONFIG_KEY and other errors gracefully
                    if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                        console.log('List access not configured for user, defaulting to false');
                    } else {
                        console.error('Error fetching list access:', error);
                    }
                    setUserListAccess(false); // Default to no list access on error or missing config
                }

                // Fetch demo mode config
                const demoModeConfig = await fetchConfig('demoMode');
                if (demoModeConfig) {
                    demoMode = demoModeConfig.value === 'true';
                    console.log('Demo mode set during initial load:', demoMode);
                } else {
                    console.log('No demo mode config found, using default (false)');
                }

                // Fetch email display permission
                try {
                    const emailDisplayPermissionResult = await authGetConfigValue(pid as string, hash as string, 'emailDisplay');
                    if (emailDisplayPermissionResult && typeof emailDisplayPermissionResult === 'boolean') {
                        console.log('Email display permission:', emailDisplayPermissionResult);
                        setEmailDisplayPermission(emailDisplayPermissionResult);
                    } else {
                        console.log('Email display permission fetch redirected or failed, using default (false)');
                        setEmailDisplayPermission(false);
                    }
                } catch (error) {
                    console.error('Error fetching email display permission:', error);
                    setEmailDisplayPermission(false);
                }

                // Fetch events, pools, and views in parallel (but not students yet)
                const [events, pools, viewsData] = await Promise.all([
                    fetchEvents(),
                    fetchPools(),
                    fetchViews()
                ]);

                // Clear view cache when views are refreshed
                clearViewCache();

                // Defensive coding: ensure we have arrays before processing
                const filteredEvents = Array.isArray(events) ? events.filter(e => !e.hide) : [];
                const filteredPools = Array.isArray(pools) ? pools : [];
                const filteredViews = Array.isArray(viewsData) ? viewsData : [];

                setAllEvents(filteredEvents);
                setAllPools(filteredPools);
                setViews(filteredViews);

                // Fetch current user's student record to get their preferences
                const currentUserStudentRecord = await fetchCurrentUserLastUsedConfig();
                const userConfig = currentUserStudentRecord?.eventDashboardLastUsedConfig;
                console.log('User config from database:', userConfig);

                // Set current event based on user preferences or fallback to config
                let currentEventToUse: Event | null = null;
                let initialView = 'Joined';

                if (userConfig?.event && Array.isArray(filteredEvents)) {
                    const foundEvent = filteredEvents.find(e => e.aid === userConfig.event) || null;
                    
                    if (foundEvent) {
                        // Check if it's a list
                        if (foundEvent.list === true) {
                            // For lists, no subEvent needed
                            foundEvent.selectedSubEvent = '';
                            currentEventToUse = foundEvent;
                            console.log('Using user preference - List:', userConfig.event);
                        } else if (userConfig?.subEvent && foundEvent.subEvents && foundEvent.subEvents[userConfig.subEvent]) {
                            // For events, check subEvent
                            foundEvent.selectedSubEvent = userConfig.subEvent;
                            currentEventToUse = foundEvent;
                            console.log('Using user preference - Event:', userConfig.event, 'SubEvent:', userConfig.subEvent);
                        } else {
                            console.log('User preference event/subEvent not found in available events');
                        }
                    } else {
                        console.log('User preference event not found in available events');
                    }
                }

                if (!currentEventToUse) {
                    // Use the first available event from user's event access list
                    if (filteredEvents.length > 0) {
                        currentEventToUse = filteredEvents[0];
                        console.log('Using first available event from user access list');
                    }
                }

                // Set initial view based on user preferences or default
                // For lists, always use 'Eligible' view
                if (currentEventToUse?.list === true) {
                    initialView = 'Eligible';
                    console.log('Using Eligible view for list');
                } else if (userConfig?.view && filteredViews.includes(userConfig.view)) {
                    initialView = userConfig.view;
                    console.log('Using user preference - View:', userConfig.view);
                } else {
                    initialView = 'Joined';
                    console.log('Using default view - Joined');
                }
                setView(initialView);

                // Ensure we have the current event set before loading students
                if (currentEventToUse) {
                    console.log('Setting evShadow:', currentEventToUse);
                    console.log('Pools loaded:', filteredPools.length);
                    console.log('Events loaded:', filteredEvents.length);

                    // Check if we have the required data
                    if (filteredPools.length === 0) {
                        console.log('No pools loaded, cannot assemble data');
                        setLoaded(true);
                        return;
                    }

                    // Set the state first to ensure it's available for other components
                    setEvShadow(currentEventToUse);

                    // Set loaded=true BEFORE calling loadStudentsForEvent for lazy loading
                    setLoaded(true);

                    // Reset accumulated eligible students ref for new event
                    accumulatedEligibleStudentsRef.current = [];

                    // Reset the "all students loaded" state for initial load
                    setAllStudentsLoadedForCurrentEvent(false);

                    // Create abort controller for initial load
                    currentLoadingAbortControllerRef.current = new AbortController();

                    // Load students for the initial event using the caching system (now in background)
                    loadStudentsForEvent(
                        currentEventToUse.aid,
                        filteredEvents,
                        filteredPools,
                        (eligibleStudents) => updateTableDataIncrementally(eligibleStudents, initialView, currentEventToUse, filteredPools),
                        currentLoadingAbortControllerRef.current
                    ).then(eligibleStudents => {
                        setCurrentEligibleStudents(eligibleStudents);

                        // Set current user information after students are loaded
                        fetchCurrentUser(eligibleStudents);
                    }).catch(error => {
                        if (error.name === 'AbortError') {
                            console.log('Initial loading operation was aborted');
                        } else {
                            console.error('Error loading students:', error);
                        }
                    });
                } else {
                    console.log('No currentEventToUse found');
                    setLoaded(true);
                }

            } catch (error) {
                console.error('Error loading initial data:', error);
                setErrMsg(error instanceof Error ? error.message : 'Unknown error');
                setLoaded(true);
            }
        };

        loadInitialData();
    }, [router.isReady, pid, hash]);



    // Handle refresh cache
    const handleRefreshCache = async () => {
        if (!evShadow || !evShadow.aid) return;

        const confirmRefresh = window.confirm(`Are you sure you want to refresh the eligibility cache for ${evShadow.name}? This will delete the existing cache and rebuild it.`);
        if (!confirmRefresh) return;

        try {
            setLoadingEligibilityCache(true);
            setLoadingProgress(prev => ({
                ...prev,
                current: 0,
                total: 0,
                message: `Deleting eligibility cache for ${evShadow.aid}...`
            }));

            // Delete the cache item
            await deleteTableItem('eligibility-cache', evShadow.aid, pid as string, hash as string);
            console.log(`Eligibility cache deleted for ${evShadow.aid}`);

            // Clear local state
            accumulatedEligibleStudentsRef.current = [];
            setAllStudentsLoadedForCurrentEvent(false);
            setCurrentEligibleStudents([]);

            // Rebuild cache
            // Create new abort controller for this load
            if (currentLoadingAbortControllerRef.current) {
                currentLoadingAbortControllerRef.current.abort();
            }
            currentLoadingAbortControllerRef.current = new AbortController();

            loadStudentsForEvent(
                evShadow.aid,
                allEvents,
                allPools,
                (eligibleStudents) => updateTableDataIncrementally(eligibleStudents, undefined, evShadow, allPools),
                currentLoadingAbortControllerRef.current
            ).then(eligibleStudents => {
                setCurrentEligibleStudents(eligibleStudents);
                fetchCurrentUser(eligibleStudents);
                toast.success('Eligibility cache refreshed successfully');
            }).catch(error => {
                if (error.name !== 'AbortError') {
                    console.error('Error rebuilding cache:', error);
                    toast.error('Failed to rebuild cache');
                }
            });

        } catch (error) {
            console.error('Error refreshing cache:', error);
            toast.error('Failed to refresh cache');
            setLoadingEligibilityCache(false);
        }
    };

    // 3. Update WebSocket message handling to process studentUpdate messages and update in-memory table, eligibility, and view
    useEffect(() => {
        if (lastMessage) {

            if (lastMessage.type === 'studentUpdate' && lastMessage.id && lastMessage.newImage) {
                // Increment the update count
                setStudentUpdateCount(prev => prev + 1);

                // Convert DynamoDB NewImage to plain object recursively
                const tempStudent: any = fromDynamo(lastMessage.newImage);
                // Ensure all required fields are present
                const newStudent: Student = {
                    id: tempStudent.id || '',
                    first: tempStudent.first || '',
                    last: tempStudent.last || '',
                    email: tempStudent.email || '',
                    programs: tempStudent.programs || {},
                    practice: tempStudent.practice || {},
                    emails: tempStudent.emails || {},
                    offeringHistory: tempStudent.offeringHistory || {}
                };
                // Assign any additional fields
                for (const key in tempStudent) {
                    if (!(key in newStudent)) {
                        (newStudent as any)[key] = tempStudent[key];
                    }
                }
                // Update in-memory allStudents
                const currentStudents = [...allStudents];
                const idx = currentStudents.findIndex(s => s.id === lastMessage.id);
                if (idx !== -1) {
                    const existing = currentStudents[idx];
                    for (const key in tempStudent) {
                        const value = fromDynamo(tempStudent[key]);
                        if (['programs', 'practice', 'emails', 'offeringHistory'].includes(key) && typeof value === 'object' && value !== null) {
                            existing[key] = deepMerge(existing[key], value);
                        } else {
                            existing[key] = value;
                        }
                    }
                    currentStudents[idx] = existing;
                } else {
                    // If new, create a full object as before
                    currentStudents.push({
                        id: tempStudent.id || '',
                        first: tempStudent.first || '',
                        last: tempStudent.last || '',
                        email: tempStudent.email || '',
                        programs: tempStudent.programs || {},
                        practice: tempStudent.practice || {},
                        emails: tempStudent.emails || {},
                        offeringHistory: tempStudent.offeringHistory || {},
                        ...tempStudent
                    });
                }
                setAllStudents(currentStudents);

                // Refresh view
                if (view) {
                    assembleColumnLabelsAndRowData(view, month, year).then(([cl, rd]) => {
                        setColumnLabels(cl);
                        setRowData(rd);
                    });
                }
            }
        }
    }, [lastMessage, view, month, year]);

    // Error display
    if (errMsg) {
        return (
            <div className="loading-container" style={{ marginTop: '70px', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

    // Loading display - simplified for lazy loading
    if (!loaded || evShadow === null) {
        return (
            <div className="loading-container" style={{ marginTop: '70px', minHeight: '400px', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: '100px' }}>
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <h1 style={{ fontSize: '32px', marginBottom: '20px', display: 'block', color: 'white', fontWeight: 'bold' }}>
                        Event Dashboard
                    </h1>
                    <b style={{ fontSize: '24px', marginBottom: '10px', display: 'block', color: 'white' }}>
                        Loading...
                    </b>
                    <Spinner animation="border" role="status" style={{ color: 'rgba(139, 69, 219, 0.8)', width: '3rem', height: '3rem' }} />
                </div>
            </div>
        );
    }

    // 4. In main render, show error if viewError is set
    if (viewError) {
        return (
            <Container style={{ fontSize: 24 }}>
                <br />
                <b>ERROR: {viewError}</b>
            </Container>
        );
    }

    // Main render

    return (
        <>
            {/* Main Content */}
            <ToastContainer />
            <Container style={{ marginTop: '20px', backgroundColor: 'transparent' }}>
                {/* Navigation Header */}
                <nav className="modern-navbar">
                    <div className="navbar-container">
                        <div className="navbar-left">
                            <div className="navbar-item event-selector">
                                <EventSelection />
                            </div>
                            {evShadow && evShadow.list !== true && (
                                <div className="navbar-item view-selector">
                                    <ViewSelection />
                                </div>
                            )}
                        </div>
                        <div className="navbar-right">
                            <div className="search-container">
                                <input
                                    value={searchTerm}
                                    onChange={(e) => handleSearchChange(e.target.value)}
                                    onKeyUp={(e) => handleSearchChange(e.currentTarget.value)}
                                    onInput={(e) => handleSearchChange(e.currentTarget.value)}
                                    id='searchInput'
                                    type="text"
                                    placeholder="Search by name..."
                                    aria-label="Search by name"
                                    className="search-input"
                                />
                            </div>
                        </div>
                    </div>
                </nav>
                <DataTable
                    data={rowData}
                    columns={columnLabels}
                    onCellValueChanged={handleCellValueChanged}
                    onCellClicked={handleCellClicked}
                    onCheckboxChanged={handleCheckboxChanged}
                    onCSVExport={handleCSVExport}
                    loading={!loaded}
                    websocketStatus={status}
                    connectionId={connectionId || undefined}
                    studentUpdateCount={studentUpdateCount}
                    itemCount={itemCount}
                    canWriteViews={canWriteViews}
                    canExportCSV={canExportCSV}
                    canViewStudentHistory={canViewStudentHistory}
                    canRefreshCache={canRefreshCache && evShadow?.config?.eligibilityCacheDisabled !== true}
                    onRefreshCache={handleRefreshCache}
                    currentUserName={currentUserName}
                    pid={pid as string}
                    hash={hash as string}
                />
            </Container>
            <StudentHistoryModal show={showHistoryModal} onClose={() => setShowHistoryModal(false)} student={selectedStudent} fetchConfig={fetchConfig} allEvents={allEvents} allPools={allPools} emailDisplayPermission={emailDisplayPermission} userEventAccess={userEventAccess} />
        </>
    );
};

export default Home; 