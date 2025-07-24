import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Button, Spinner } from "react-bootstrap";
import { ToastContainer, toast } from 'react-toastify';
import { isMobile } from 'react-device-detect';
import Navbar from "react-bootstrap/Navbar";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import Modal from 'react-bootstrap/Modal';

import 'react-toastify/dist/ReactToastify.css';

// Import sharedFrontend utilities
import {
    getAllTableItems,
    updateTableItem,
    getTableItemOrNull,
    authGetViews,
    authGetViewsWritePermission,
    authGetViewsExportCSV,
    authGetViewsHistoryPermission,
    useWebSocket,
    getTableCount,
    checkEligibility,
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
const StudentHistoryModal = ({ show, onClose, student, fetchConfig }) => {
    const [copying, setCopying] = React.useState(false);
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
    // Gather all subevents from allEvents
    const subEvents: SubEvent[] = [];
    if (Array.isArray(allEvents)) {
        allEvents.forEach(event => {
            if (event.hide) return;
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
    // Sort subevents by date descending
    subEvents.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
    // Add click handler for event row
    const handleEventRowClick = async (sub) => {
        const eligible = getEligibility(sub.event, sub.subEventKey);
        if (!eligible) return;
        setCopying(true);
        try {
            const regDomainConfig = await fetchConfig('registrationDomain');
            const regDomain = typeof regDomainConfig === 'string' ? regDomainConfig : regDomainConfig?.value || '';
            if (!regDomain) throw new Error('No registration domain configured');
            const url = `${regDomain}/?pid=${student.id}&aid=${sub.event.aid}`;
            await navigator.clipboard.writeText(url);
            toast.success(`Registration link copied: ${url}`, { autoClose: 4000 });
        } catch (err) {
            toast.error('Failed to copy registration link');
        } finally {
            setCopying(false);
        }
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
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: '#007bff' }}
                        title="Click to copy email"
                        onClick={() => handleCopy(student.email, 'email')}
                    >
                        {student.email}
                    </span>
                    <br />
                    <b>Country:</b> {student.country || 'Unknown'} <br />
                    <b>Languages:</b> {student.spokenLangPref || ''}{student.writtenLangPref ? ` / ${student.writtenLangPref}` : ''} <br />
                </div>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Event Participation</div>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    <table className="table table-sm table-bordered" style={{ position: 'relative' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8f9fa' }}>
                            <tr>
                                <th>Date</th>
                                <th>Event</th>
                                <th>Eligible</th>
                                <th>Joined</th>
                                <th>Offering</th>
                            </tr>
                        </thead>
                        <tbody>
                            {subEvents.map(sub => {
                                const eligible = getEligibility(sub.event, sub.subEventKey);
                                const joined = getJoined(sub.event, sub.subEventKey);
                                const offering = getOffering(sub.event, sub.subEventKey);
                                return (
                                    <tr key={sub.eventKey}>
                                        <td>{sub.date}</td>
                                        <td
                                            style={{ cursor: eligible ? 'pointer' : 'not-allowed', color: eligible ? '#007bff' : undefined, textDecoration: eligible ? 'underline dotted' : undefined }}
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

    const [loaded, setLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });
    const [name, setName] = useState("Unknown");
    const [forceRenderValue, setForceRenderValue] = useState(0);
    const [currentEventAid, setCurrentEventAid] = useState('admin-dashboard');
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
    const [studentUpdateCount, setStudentUpdateCount] = useState(0);
    const initialLoadStarted = useRef(false);
    // 1. Add state for error message when view is missing
    const [viewError, setViewError] = useState<string | null>(null);
    const [canWriteViews, setCanWriteViews] = useState<boolean>(false);
    const [canExportCSV, setCanExportCSV] = useState<boolean>(false);
    const [currentViewConditions, setCurrentViewConditions] = useState<any[]>([]);
    const [canViewStudentHistory, setCanViewStudentHistory] = useState<boolean>(false);

    // WebSocket connection
    const { lastMessage, sendMessage, status, connectionId } = useWebSocket();

    // Component-specific helper functions
    const forceRender = useCallback(() => setForceRenderValue(v => v + 1), []);

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
                        message: `Loading students...`
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
                    message: `Loading students...`
                }));
            });

            // Check if we got a redirected response
            if (students && 'redirected' in students) {
                console.log('Students fetch redirected - authentication required');
                return [];
            }

            return students as Student[];
        } catch (error) {
            console.error('Error fetching students:', error);
            toast.error('Failed to fetch students');
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

    const fetchView = async (viewName: string) => {
        try {
            // Correct: look in 'views' table, use viewName as-is
            const view = await getTableItemOrNull('views', viewName, pid as string, hash as string);
            if (view && 'redirected' in view) {
                console.log('View fetch redirected - authentication required');
                return null;
            }
            return view as View;
        } catch (error) {
            console.error('Error fetching view:', error);
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

    const updateStudentEventField = async (studentId: string, fieldName: string, fieldValue: any) => {
        if (!currentEvent || !currentEvent.aid) {
            toast.error('No current event selected');
            return false;
        }
        const eventFieldName = `programs.${currentEvent.aid}.${fieldName}`;
        try {
            await updateTableItem('students', studentId, eventFieldName, fieldValue, pid as string, hash as string);
            toast.success('Field updated successfully');
            return true;
        } catch (error) {
            console.error('Error updating student event field:', error);
            toast.error('Failed to update field');
            return false;
        }
    };

    // Helper functions
    const addEligible = (student: Student) => {
        // Return early if student is unsubscribed
        if (student.unsubscribe) {
            return;
        }

        // Check eligibility using the new checkEligibility function
        if (currentEvent && currentEvent.config?.pool && Array.isArray(allPools) && allPools.length > 0) {
            const isEligible = checkEligibility(currentEvent.config.pool, student, currentEvent.aid, allPools);
            if (isEligible) {
                eligibleStudents.push(student);
            }
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
            navigator.clipboard.writeText(rowData.email);
            toast.info(`Copied ${rowData.email} to the clipboard`, { autoClose: 3000 });
        } else if (field === 'owyaa') {
            handleOWYAA(rowData.id, rowData.name);
        }
    };

    const handleCheckboxChanged = async (field: string, rowIndex: number, checked: boolean) => {
        if (!canWriteViews) {
            toast.info('Value not changed. READ ONLY', { autoClose: 3000 });
            return;
        }

        const student = rowData[rowIndex];
        if (!student) return;

        let dataField = field;
        if (field === 'joined') dataField = 'join';
        if (field === 'installmentsLF') dataField = 'limitFee';

        if (field.startsWith('currentAIDBool')) {
            dataField = columnMetaData[field]?.boolName || field;
        }

        const success = await updateStudentEventField(student.id, dataField, checked);
        if (success) {
            // Update local data
            const updatedRowData = [...rowData];
            updatedRowData[rowIndex] = { ...student, [field]: checked };
            setRowData(updatedRowData);
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
                allStudents[studentIndex].owyaaLease = leaseTimestamp;
                toast.info(`OWYAA Enabled for ${name} for 90 days`, { autoClose: 3000 });
            }
        } else {
            const success = await updateStudentEventField(id, 'owyaaLease', '');
            if (success) {
                delete allStudents[studentIndex].owyaaLease;
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

        // Filter the data immediately without API calls
        const filteredStudents = (Array.isArray(eligibleStudents) ? eligibleStudents : []).filter(student => {
            if (!currentEvent) return false;

            // Apply view conditions first
            const conditionsResult = studentMatchesViewConditions(student, currentViewConditions, currentEvent, allPools);
            if (!conditionsResult) {
                return false;
            }

            // Apply search filter
            if (searchValue) {
                const searchLower = searchValue.toLowerCase();
                const fullName = `${student.first} ${student.last}`.toLowerCase();
                const email = student.email.toLowerCase();
                if (!fullName.includes(searchLower) && !email.includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });



        // Generate new row data
        const newRowData: any[] = [];
        if (currentEvent) {
            for (const student of filteredStudents) {
                const row = getRowValuesForStudent(student, columnLabels, columnMetaData, currentEvent, allPools);
                if (row !== null) {
                    newRowData.push(row);
                }
            }
        }

        setRowData(newRowData);
        setItemCount(newRowData.length);
    };

    const handleSearchChange = (searchValue: string) => {
        // Immediate search on each character
        handleSearch(searchValue);
    };

    const handleCSVExport = () => {
        // This will be handled by the DataTable component
        console.log("CSV export handled by DataTable");
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

    // Helper function to get all sub-events from all events
    const getAllSubEvents = (events: Event[]): SubEventItem[] => {
        const subEvents: SubEventItem[] = [];

        // Defensive coding: ensure events is an array
        if (!Array.isArray(events)) {
            return subEvents;
        }

        events.forEach(event => {
            if (event.hide) return; // Skip hidden events

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
        const handleEventSelection = async (eventKey: string | null) => {
            if (!eventKey) return;

            // Parse the event key to get event aid and sub-event key
            const [eventAid, subEventKey] = eventKey.includes(':') ? eventKey.split(':') : [eventKey, ''];

            // Find the event by aid
            const selectedEvent = allEvents.find(e => e.aid === eventAid) || null;
            if (!selectedEvent) return;

            // Set the current event and sub-event
            currentEvent = selectedEvent;

            // Store the selected sub-event in the event object for reference
            if (subEventKey) {
                currentEvent.selectedSubEvent = subEventKey;
            }

            localStorage.setItem('event', JSON.stringify(currentEvent));
            eligibleStudents = [];

            allStudents.forEach(student => addEligible(student));
            eligibleStudents.sort(compareNames);

            setEvShadow(currentEvent);
            const [cl, rd] = await assembleColumnLabelsAndRowData(view || 'Joined', month, year);
            setColumnLabels(cl);
            setRowData(rd);
        };

        // Get all sub-events and sort them
        const allSubEvents = getAllSubEvents(Array.isArray(allEvents) ? allEvents : []);
        const sortedSubEvents = sortSubEventsByDate(allSubEvents);

        // Find the current sub-event for the title
        let currentSubEvent: SubEventItem | null = null;
        if (currentEvent) {
            const selectedKey = currentEvent.selectedSubEvent;
            currentSubEvent = allSubEvents.find(se =>
                se.event.aid === currentEvent!.aid &&
                (selectedKey ? se.subEventKey === selectedKey : true)
            ) || null;
        }

        const title = currentSubEvent ? currentSubEvent.displayText : "Select Event";

        return (
            <DropdownButton
                className="group"
                id="dropdown-basic-button"
                onSelect={handleEventSelection}
                title={title}
            >
                {sortedSubEvents.map((subEvent) => (
                    <Dropdown.Item key={subEvent.eventKey} eventKey={subEvent.eventKey}>
                        {subEvent.displayText}
                    </Dropdown.Item>
                ))}
            </DropdownButton>
        );
    };

    const ViewSelection = () => {
        const handleViewSelection = async (viewName: string | null) => {
            if (!viewName) {
                return;
            }
            setView(viewName);
            try {
                const [cl, rd] = await assembleColumnLabelsAndRowData(viewName, month, year);
                setColumnLabels(cl);
                setRowData(rd);
            } catch (error) {
                console.error('[VIEW SELECTION DEBUG] Error in assembleColumnLabelsAndRowData', { viewName, error });
            }
        };

        return (
            <DropdownButton
                className="group"
                id="dropdown-view-button"
                onSelect={handleViewSelection}
                title={view || "Select View"}
            >
                {views.map((viewName) => (
                    <Dropdown.Item key={viewName} eventKey={viewName}>
                        {viewName}
                    </Dropdown.Item>
                ))}
            </DropdownButton>
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
        allPools: Pool[]
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
                    rowValues[field] = student.email;
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
        setViewError(null); // Reset error
        let effectiveViewName = viewName;
        // Check for translation in currentEvent.config.dashboardViews
        if (currentEvent && currentEvent.config && currentEvent.config.dashboardViews) {
            const translation = currentEvent.config.dashboardViews[viewName];
            if (translation) {
                effectiveViewName = translation;
            }
            // If no translation, just use the original viewName (do not show error)
        }
        // Fetch the view definition
        const viewConfig = await fetchView(effectiveViewName);
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

        // Filter students: eligibility, then view conditions, then search
        const filteredStudents = (Array.isArray(eligibleStudents) ? eligibleStudents : []).filter(student => {
            if (!currentEvent) {
                return false;
            }

            const conditionsResult = studentMatchesViewConditions(student, conditions, currentEvent, allPools);
            if (!conditionsResult) {
                return false;
            }
            // Apply search filter
            if (searchTerm) {
                const searchLower = searchTerm.toLowerCase();
                const fullName = `${student.first} ${student.last}`.toLowerCase();
                const email = student.email.toLowerCase();
                if (!fullName.includes(searchLower) && !email.includes(searchLower)) {
                    return false;
                }
            }
            return true;
        });

        const rowValues: any[] = [];
        if (currentEvent) {
            for (const student of filteredStudents) {
                const row = getRowValuesForStudent(student, columnLabels, columnMetaData, currentEvent, allPools);
                if (row !== null) {
                    rowValues.push(row);
                }
            }
        }
        setItemCount(rowValues.length);
        return [columnLabels, rowValues];
    };

    // Main initialization effect
    useEffect(() => {
        if (!router.isReady || !pid || !hash) return;
        if (initialLoadStarted.current) return;

        initialLoadStarted.current = true;

        const loadInitialData = async () => {
            try {
                setLoadingProgress({ current: 0, total: 1, message: 'Starting data load...' });

                // Fetch write permission
                const writePermission = await authGetViewsWritePermission(pid as string, hash as string);
                setCanWriteViews(writePermission === true);
                // Fetch export CSV permission
                const exportCSV = await authGetViewsExportCSV(pid as string, hash as string);
                setCanExportCSV(exportCSV === true);
                // Fetch student history permission
                const historyPermission = await authGetViewsHistoryPermission(pid as string, hash as string);
                setCanViewStudentHistory(historyPermission === true);

                // Fetch all data in parallel
                const [students, events, pools, viewsData] = await Promise.all([
                    fetchStudents(),
                    fetchEvents(),
                    fetchPools(),
                    fetchViews()
                ]);

                // Defensive coding: ensure we have arrays before processing
                allStudents = Array.isArray(students) ? students : [];
                allEvents = Array.isArray(events) ? events.filter(e => !e.hide) : [];
                allPools = Array.isArray(pools) ? pools : [];
                setViews(Array.isArray(viewsData) ? viewsData : []);



                // Set current event
                const aidData = await fetchConfig("adminDashboardLandingAID");
                const seData = await fetchConfig("adminDashboardLandingSubEvent");

                if (aidData && seData && aidData.value && seData.value && Array.isArray(allEvents)) {
                    currentEvent = allEvents.find(e => e.aid === aidData.value && e.subEvents && e.subEvents[seData.value]) || null;
                    // Set the selected sub-event in the event object for reference
                    if (currentEvent && seData.value) {
                        currentEvent.selectedSubEvent = seData.value;
                    }
                }

                if (!currentEvent && Array.isArray(allEvents) && allEvents.length > 0) {
                    currentEvent = allEvents[0];
                }

                // Process eligible students
                eligibleStudents = [];
                if (currentEvent && Array.isArray(allStudents)) {
                    allStudents.forEach(student => addEligible(student));
                    eligibleStudents.sort(compareNames);
                }

                // Set initial view
                setView('Joined');
                const [cl, rd] = await assembleColumnLabelsAndRowData('Joined', month, year);
                setColumnLabels(cl);
                setRowData(rd);
                setEvShadow(currentEvent);
                setLoaded(true);

            } catch (error) {
                console.error('Error loading initial data:', error);
                setErrMsg(error instanceof Error ? error.message : 'Unknown error');
                setLoaded(true);
            }
        };

        loadInitialData();
    }, [router.isReady, pid, hash]);

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
                const idx = allStudents.findIndex(s => s.id === lastMessage.id);
                if (idx !== -1) {
                    const existing = allStudents[idx];
                    for (const key in tempStudent) {
                        const value = fromDynamo(tempStudent[key]);
                        if (['programs', 'practice', 'emails', 'offeringHistory'].includes(key) && typeof value === 'object' && value !== null) {
                            existing[key] = deepMerge(existing[key], value);
                        } else {
                            existing[key] = value;
                        }
                    }
                    allStudents[idx] = existing;
                    // Debug: log the final state after merge
                    console.log('[Student Merge] After merge:', JSON.parse(JSON.stringify(existing)));
                } else {
                    // If new, create a full object as before
                    allStudents.push({
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
                // Rebuild eligibleStudents
                eligibleStudents = [];
                if (currentEvent && Array.isArray(allStudents)) {
                    allStudents.forEach(student => addEligible(student));
                    eligibleStudents.sort(compareNames);
                }
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
            <Container style={{ fontSize: 24 }}>
                <br />
                <b>ERROR: {errMsg}</b>
            </Container>
        );
    }

    // Loading display
    if (!loaded || currentEvent === null) {
        const progress = loadingProgress.total > 0
            ? Math.min(100, Math.round((loadingProgress.current / loadingProgress.total) * 100))
            : 0;

        return (
            <Container style={{
                fontSize: 18,
                marginTop: '70px',
                color: 'white',
                backgroundColor: '#007bff',
                padding: '20px',
                borderRadius: '8px',
                minHeight: '200px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <b style={{ fontSize: '24px', marginBottom: '10px', display: 'block' }}>
                        {loadingProgress.message || 'Loading...'}
                    </b>
                    <Spinner animation="border" role="status" style={{ color: 'white', width: '3rem', height: '3rem' }} />
                </div>

                {loadingProgress.current > 0 && (
                    <div style={{ width: '100%', maxWidth: '400px' }}>
                        <div style={{ color: 'white', marginBottom: '10px', textAlign: 'center' }}>
                            Items loaded: {loadingProgress.current}
                            {loadingProgress.total > loadingProgress.current && ` of ${loadingProgress.total}`}
                        </div>
                        <div style={{ color: 'white', marginBottom: '15px', textAlign: 'center' }}>
                            {loadingProgress.total > loadingProgress.current ?
                                `Progress: ${Math.round((loadingProgress.current / loadingProgress.total) * 100)}%` :
                                `Chunks processed: ${Math.ceil(loadingProgress.current / 100)}`
                            }
                        </div>
                        <div style={{
                            width: '100%',
                            backgroundColor: 'rgba(255,255,255,0.3)',
                            borderRadius: '10px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${Math.min(100, (loadingProgress.current / loadingProgress.total) * 100)}%`,
                                height: '25px',
                                backgroundColor: 'white',
                                borderRadius: '10px',
                                transition: 'width 0.3s ease'
                            }}></div>
                        </div>
                    </div>
                )}
            </Container>
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
            {/* Navigation Header */}
            <Navbar sticky="top" bg="primary" variant="dark" expand="lg" style={{ fontSize: 18 }}>
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                <div className="d-flex flex-wrap align-items-center w-100 gap-2">
                    <div style={{ minWidth: 500 }} className="me-2">
                        <EventSelection />
                    </div>
                    <div style={{ minWidth: 180 }} className="me-2">
                        <ViewSelection />
                    </div>
                    <div className="ms-auto me-2 d-flex align-items-center">
                        <Form.Control
                            onChange={(e) => handleSearchChange(e.target.value)}
                            id='searchInput'
                            type="search"
                            placeholder="Search"
                            aria-label="Search"
                            style={{ minWidth: 200, maxWidth: 300, height: 40 }}
                        />
                        {canExportCSV && (
                            <Button
                                variant="secondary"
                                className="ms-2"
                                onClick={handleCSVExport}
                                style={{ minWidth: 120, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', fontSize: 18 }}
                            >
                                Export CSV
                            </Button>
                        )}
                    </div>
                </div>
            </Navbar>
            {/* Main Content */}
            <ToastContainer />
            {/* In the main content area, ensure only one stats/badge row is rendered and all badges are styled consistently: */}
            <Container style={{ marginTop: '20px', backgroundColor: 'transparent' }}>
                <DataTable
                    data={rowData}
                    columns={columnLabels}
                    onCellValueChanged={handleCellValueChanged}
                    onCellClicked={handleCellClicked}
                    onCheckboxChanged={handleCheckboxChanged}
                    loading={!loaded}
                    websocketStatus={status}
                    connectionId={connectionId || undefined}
                    studentUpdateCount={studentUpdateCount}
                    itemCount={itemCount}
                    canWriteViews={canWriteViews}
                    canExportCSV={canExportCSV}
                    canViewStudentHistory={canViewStudentHistory}
                />
            </Container>
            <StudentHistoryModal show={showHistoryModal} onClose={() => setShowHistoryModal(false)} student={selectedStudent} fetchConfig={fetchConfig} />
        </>
    );
};

export default Home; 