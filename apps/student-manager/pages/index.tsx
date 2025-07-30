import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Button, Spinner, Modal } from "react-bootstrap";
import { ToastContainer, toast } from 'react-toastify';
import { isMobile } from 'react-device-detect';

import 'react-toastify/dist/ReactToastify.css';

// Import sharedFrontend utilities
import {
    getAllTableItems,
    updateTableItem,
    getTableItemOrNull,
    putTableItem,
    deleteTableItem,
    getTableCount,
    checkEligibility,
    authGetLink,

    authGetAuthList,
    authGetViewsProfiles,
    authPutAuthItem,
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
    [key: string]: any;
}

interface AuthRecord {
    id: string;
    adminDashboardConfig: {
        exportCSV: boolean;
        studentHistory: boolean;
        viewsProfile: string;
        writePermission: boolean;
    };
    'permitted-hosts': string[]; // Now just an array of host strings
}



interface ViewsProfile {
    id: string;
    views: string[];
}

interface Config {
    value: string;
    [key: string]: any;
}

// Module-level variables
let allStudents: Student[] = [];
let allAuthRecords: AuthRecord[] = [];
let allPools: Pool[] = [];
let eligibleStudents: Student[] = [];

let allViewsProfiles: ViewsProfile[] = [];
let accessManagerAppList: string[] = [];
let accessManagerPool: string = '';

// Language options for the dropdown
const LANGUAGE_OPTIONS = [
    'English',
    'Spanish',
    'French',
    'Portuguese',
    'Czech',
    'German',
    'Italian'
];

const Home = () => {
    const router = useRouter();
    const { pid, hash } = router.query;

    // State variables
    const [loaded, setLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [columnLabels, setColumnLabels] = useState<Column[]>([]);
    const [rowData, setRowData] = useState<any[]>([]);
    const [itemCount, setItemCount] = useState(0);
    const [currentUserName, setCurrentUserName] = useState<string>("Unknown");
    const [version, setVersion] = useState<string>("dev");
    const [canWriteViews, setCanWriteViews] = useState<boolean>(true);
    const [demoMode, setDemoMode] = useState<boolean>(false);

    // Modal state
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedAuthRecord, setSelectedAuthRecord] = useState<AuthRecord | null>(null);
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

    // Form state for add/edit
    const [formData, setFormData] = useState({
        studentId: '',
        // Student profile fields (students table)
        studentProfile: {
            first: '',
            last: '',
            email: '',
            writtenLangPref: '',
            spokenLangPref: ''
        },
        // Shadow values to track changes
        shadowValues: {
            first: '',
            last: '',
            email: '',
            writtenLangPref: '',
            spokenLangPref: ''
        },
        // Auth fields (auth table)
        adminDashboardConfig: {
            exportCSV: false,
            studentHistory: false,
            viewsProfile: '',
            writePermission: false
        },
        permittedHosts: [] as string[] // Now just an array of host strings
    });

    const initialLoadStarted = useRef(false);

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
                    total: totalCount || Math.max(count, prev.total),
                    message: `Loading students...`
                }));
            });

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

    const fetchAuthRecords = async () => {
        try {
            const authRecords = await authGetAuthList(pid as string, hash as string);

            if (authRecords && 'redirected' in authRecords) {
                console.log('Auth records fetch redirected - authentication required');
                return [];
            }

            return authRecords as AuthRecord[];
        } catch (error) {
            console.error('Error fetching auth records:', error);
            toast.error('Failed to fetch auth records');
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



    const fetchViewsProfiles = async () => {
        try {
            const profileNames = await authGetViewsProfiles(pid as string, hash as string);
            console.log('fetchViewsProfiles: raw profileNames:', profileNames);

            if (profileNames && 'redirected' in profileNames) {
                console.log('Views profiles fetch redirected - authentication required');
                return [];
            }

            // Convert profile names to ViewsProfile format for compatibility
            let result = profileNames.map((profileName: string) => ({
                id: profileName,
                views: [] // We don't need the views array for the dropdown
            })) as ViewsProfile[];

            // If no profiles found, provide some defaults for testing
            if (result.length === 0) {
                console.log('fetchViewsProfiles: No profiles found, using defaults');
                result = [
                    { id: 'basic', views: [] },
                    { id: 'admin', views: [] },
                    { id: 'superuser', views: [] }
                ];
            }

            console.log('fetchViewsProfiles: final result:', result);
            return result;
        } catch (error) {
            console.error('Error fetching views profiles:', error);
            toast.error('Failed to fetch views profiles');

            // Return defaults on error
            return [
                { id: 'basic', views: [] },
                { id: 'admin', views: [] },
                { id: 'superuser', views: [] }
            ];
        }
    };

    const fetchConfig = async (configName: string) => {
        try {
            const config = await getTableItemOrNull('config', configName, pid as string, hash as string);

            if (config && 'redirected' in config) {
                console.log(`Config fetch redirected for ${configName} - authentication required`);
                return null;
            }

            return config as Config;
        } catch (error) {
            console.error('Error fetching config:', error);
            return null;
        }
    };

    const fetchCurrentUser = (studentsArray?: Student[]) => {
        try {
            const studentsToUse = studentsArray || allStudents;

            if (!pid || !Array.isArray(studentsToUse) || studentsToUse.length === 0) {
                setCurrentUserName(`User ${pid || 'Unknown'}`);
                return;
            }

            const currentUser = studentsToUse.find(student => student.id === pid);

            if (currentUser) {
                const firstName = currentUser.first || '';
                const lastName = currentUser.last || '';
                const fullName = `${firstName} ${lastName}`.trim();
                setCurrentUserName(fullName || 'Unknown User');
            } else {
                setCurrentUserName(`User ${pid}`);
            }
        } catch (error) {
            console.error('Error setting current user name:', error);
            setCurrentUserName(`User ${pid || 'Unknown'}`);
        }
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

    // Helper functions
    const compareNames = (a: Student, b: Student) => {
        if (a.first + a.last < b.first + b.last) return -1;
        if (a.first + a.last > b.first + b.last) return 1;
        return 0;
    };

    // Helper function to format domain names for display
    const formatDomainForDisplay = (domain: string): string => {
        // Remove everything up to and including the first '.' after the subdomain
        // e.g., "student-manager.slsupport.link" -> "student-manager"
        const parts = domain.split('.');
        return parts[0];
    };

    const getStudentName = (studentId: string): string => {
        const student = allStudents.find(s => s.id === studentId);
        return student ? `${student.first} ${student.last}` : studentId;
    };

    const getStudentEmail = (studentId: string): string => {
        const student = allStudents.find(s => s.id === studentId);
        return student ? student.email : '';
    };

    // Helper function to mask email in demo mode
    const maskEmail = (email: string, demoModeValue: boolean = demoMode): string => {
        console.log('maskEmail called with:', email, 'demoMode:', demoModeValue);
        if (demoModeValue && email) {
            console.log('Masking email:', email);
            return 'xxxxxxxxxx';
        }
        return email;
    };

    const buildColumnLabelsAndRowData = (demoModeValue: boolean = demoMode) => {
        const columns: Column[] = [
            { field: 'rowIndex', headerName: '#', pinned: 'left', width: 75 },
            { field: 'studentName', headerName: 'Student Name', pinned: 'left', sortable: true },
            { field: 'unsubscribed', headerName: 'Unsub', width: 80, cellRenderer: 'checkboxRenderer', writeEnabled: true, sortable: true },
            { field: 'email', headerName: 'Email', sortable: true },
            { field: 'language', headerName: 'Language', sortable: true },
            { field: 'permittedApps', headerName: 'Permitted Apps', sortable: true },
            { field: 'studentId', headerName: 'Student ID', hide: true } // Hidden column for student ID
        ];

        const rowValues: any[] = [];

        // Get default auth record for fallback
        const defaultAuthRecord = allAuthRecords.find(ar => ar.id === 'default');

        // Include all students (not just eligible ones) so we can see and manage unsubscribe status
        const allStudentsForTable = allStudents.filter(student => student.id !== 'default');

        // Apply search filter
        const filteredStudents = allStudentsForTable.filter(student => {
            if (searchTerm && searchTerm.trim()) {
                const searchLower = searchTerm.toLowerCase().trim();
                const fullName = `${student.first} ${student.last}`.toLowerCase();
                return fullName.includes(searchLower);
            }
            return true;
        });

        filteredStudents.forEach((student, index) => {
            // Find auth record for this student
            const authRecord = allAuthRecords.find(ar => ar.id === student.id);

            // Determine permitted apps: show None for unsubscribed students, otherwise use auth record or default
            let permittedApps = 'None';
            if (!student.unsubscribe) {
                if (authRecord && authRecord['permitted-hosts']) {
                    permittedApps = authRecord['permitted-hosts'].map(formatDomainForDisplay).join(', ');
                } else if (defaultAuthRecord && defaultAuthRecord['permitted-hosts']) {
                    permittedApps = defaultAuthRecord['permitted-hosts'].map(formatDomainForDisplay).join(', ');
                }
            }

            // Determine email and language - hide for unsubscribed students
            const isUnsubscribed = student.unsubscribe || false;
            const email = isUnsubscribed ? '' : maskEmail(student.email || '', demoModeValue);
            const language = isUnsubscribed ? '' : (student.writtenLangPref || 'English');

            rowValues.push({
                rowIndex: index + 1,
                studentName: `${student.first} ${student.last}`,
                unsubscribed: student.unsubscribe || false,
                email,
                language,
                permittedApps,
                studentId: student.id,
                authRecord: authRecord || defaultAuthRecord,
                isUnsubscribed: student.unsubscribe || false
            });
        });

        setItemCount(rowValues.length);
        return [columns, rowValues];
    };

    // Event handlers
    const handleSearch = (searchValue: string) => {
        setSearchTerm(searchValue);
        const [cl, rd] = buildColumnLabelsAndRowData(demoMode);
        setColumnLabels(cl);
        setRowData(rd);
    };

    const handleSearchChange = (searchValue: string) => {
        handleSearch(searchValue);
    };

    const handleCellClicked = (field: string, rowData: any) => {
        console.log('handleCellClicked called:', field, rowData);
        if (field === 'studentName') {
            const student = allStudents.find(s => s.id === rowData.studentId);
            if (student) {
                // Don't allow editing if student is unsubscribed
                if (student.unsubscribe) {
                    toast.warning('Cannot edit unsubscribed students');
                    return;
                }

                setSelectedStudent(student);
                setSelectedAuthRecord(rowData.authRecord);
                const permittedHosts = Array.isArray(rowData.authRecord?.['permitted-hosts'])
                    ? [...rowData.authRecord['permitted-hosts']]
                    : [];

                setFormData({
                    studentId: rowData.studentId,
                    studentProfile: {
                        first: student?.first || '',
                        last: student?.last || '',
                        email: student?.email || '',
                        writtenLangPref: student?.writtenLangPref || 'English',
                        spokenLangPref: student?.spokenLangPref || 'English'
                    },
                    shadowValues: {
                        first: student?.first || '',
                        last: student?.last || '',
                        email: student?.email || '',
                        writtenLangPref: student?.writtenLangPref || 'English',
                        spokenLangPref: student?.spokenLangPref || 'English'
                    },
                    adminDashboardConfig: {
                        exportCSV: rowData.authRecord?.adminDashboardConfig?.exportCSV || false,
                        studentHistory: rowData.authRecord?.adminDashboardConfig?.studentHistory || false,
                        viewsProfile: rowData.authRecord?.adminDashboardConfig?.viewsProfile || '',
                        writePermission: rowData.authRecord?.adminDashboardConfig?.writePermission || false
                    },
                    permittedHosts: permittedHosts
                });
                setShowEditModal(true);
            }
        } else if (field === 'permittedApp') {
            console.log('Handling permittedApp click:', rowData);
            console.log('Available students:', allStudents.length);
            console.log('Looking for student ID:', rowData.studentId);

            // Check if data is loaded
            if (allStudents.length === 0) {
                console.log('No students loaded yet, using fallback');
                // Use fallback immediately
                if (rowData.studentName) {
                    const [firstName, lastName] = rowData.studentName.split(' ');
                    const fallbackStudent = { first: firstName, last: lastName || '' };
                    const appName = rowData.appName;
                    const fullDomain = accessManagerAppList.find(app =>
                        formatDomainForDisplay(app) === appName
                    );

                    if (fullDomain) {
                        handleCopyLink(fullDomain, rowData.studentId, fallbackStudent);
                    }
                }
                return;
            }

            const student = allStudents.find(s => s.id === rowData.studentId);
            console.log('Found student:', student);

            if (student && !student.unsubscribe) {
                // Convert display name back to full domain name
                const appName = rowData.appName;
                console.log('Looking for app:', appName, 'in list:', accessManagerAppList);
                const fullDomain = accessManagerAppList.find(app =>
                    formatDomainForDisplay(app) === appName
                );

                console.log('Found full domain:', fullDomain);
                if (fullDomain) {
                    handleCopyLink(fullDomain, rowData.studentId, student);
                } else {
                    console.error('Could not find full domain for app:', appName);
                }
            } else {
                console.log('Student not found or unsubscribed:', student);
                // Try to get student name from rowData as fallback
                if (rowData.studentName) {
                    const [firstName, lastName] = rowData.studentName.split(' ');
                    const fallbackStudent = { first: firstName, last: lastName || '' };
                    const appName = rowData.appName;
                    const fullDomain = accessManagerAppList.find(app =>
                        formatDomainForDisplay(app) === appName
                    );

                    if (fullDomain) {
                        handleCopyLink(fullDomain, rowData.studentId, fallbackStudent);
                    }
                }
            }
        }
    };

    const updateStudentField = async (studentId: string, fieldName: string, fieldValue: any) => {
        try {
            await updateTableItem('students', studentId, fieldName, fieldValue, pid as string, hash as string);
            toast.success('Field updated successfully');
            return true;
        } catch (error) {
            console.error('Error updating student field:', error);
            toast.error('Failed to update field');
            return false;
        }
    };

    const handleCheckboxChanged = async (field: string, studentId: string, checked: boolean) => {
        if (!canWriteViews) {
            toast.info('Value not changed. READ ONLY', { autoClose: 3000 });
            return;
        }

        // Find the student by ID
        const student = rowData.find(s => s.studentId === studentId);
        if (!student) {
            console.error('Student not found for ID:', studentId);
            return;
        }

        let dataField = field;
        if (field === 'unsubscribed') dataField = 'unsubscribe';

        const success = await updateStudentField(studentId, dataField, checked);
        if (success) {
            // Update the global allStudents array first
            const studentIndex = allStudents.findIndex(s => s.id === studentId);
            if (studentIndex !== -1) {
                const updatedStudents = [...allStudents];
                updatedStudents[studentIndex] = { ...allStudents[studentIndex], unsubscribe: checked };
                allStudents = updatedStudents;
            }

            // Recalculate permitted apps for this student
            const updatedStudent = allStudents.find(s => s.id === studentId);
            const defaultAuthRecord = allAuthRecords.find(ar => ar.id === 'default');
            const authRecord = allAuthRecords.find(ar => ar.id === studentId);

            // Determine permitted apps: show None for unsubscribed students, otherwise use auth record or default
            let permittedApps = 'None';
            if (!checked) { // Only show permitted apps if not unsubscribed
                if (authRecord && authRecord['permitted-hosts']) {
                    permittedApps = authRecord['permitted-hosts'].map(formatDomainForDisplay).join(', ');
                } else if (defaultAuthRecord && defaultAuthRecord['permitted-hosts']) {
                    permittedApps = defaultAuthRecord['permitted-hosts'].map(formatDomainForDisplay).join(', ');
                }
            }

            // Update local data by finding the correct row index
            const rowIndex = rowData.findIndex(s => s.studentId === studentId);
            if (rowIndex !== -1) {
                const updatedRowData = [...rowData];
                const updatedStudent = allStudents.find(s => s.id === studentId);

                // Determine email and language - hide for unsubscribed students
                const email = checked ? '' : maskEmail(updatedStudent?.email || '', demoMode);
                const language = checked ? '' : (updatedStudent?.writtenLangPref || 'English');

                updatedRowData[rowIndex] = {
                    ...student,
                    [field]: checked,
                    email,
                    language,
                    permittedApps: permittedApps,
                    isUnsubscribed: checked
                };
                setRowData(updatedRowData);
            }
        }
    };

    const handleEdit = (authRecord: AuthRecord) => {
        const student = allStudents.find(s => s.id === authRecord.id);
        if (student) {
            // Don't allow editing if student is unsubscribed
            if (student.unsubscribe) {
                toast.warning('Cannot edit unsubscribed students');
                return;
            }

            const permittedHosts = Array.isArray(authRecord?.['permitted-hosts'])
                ? [...authRecord['permitted-hosts']]
                : [];

            setSelectedStudent(student);
            setSelectedAuthRecord(authRecord);
            setFormData({
                studentId: authRecord.id,
                studentProfile: {
                    first: student?.first || '',
                    last: student?.last || '',
                    email: student?.email || '',
                    writtenLangPref: student?.writtenLangPref || 'English',
                    spokenLangPref: student?.spokenLangPref || 'English'
                },
                shadowValues: {
                    first: student?.first || '',
                    last: student?.last || '',
                    email: student?.email || '',
                    writtenLangPref: student?.writtenLangPref || 'English',
                    spokenLangPref: student?.spokenLangPref || 'English'
                },
                adminDashboardConfig: {
                    exportCSV: authRecord?.adminDashboardConfig?.exportCSV || false,
                    studentHistory: authRecord?.adminDashboardConfig?.studentHistory || false,
                    viewsProfile: authRecord?.adminDashboardConfig?.viewsProfile || '',
                    writePermission: authRecord?.adminDashboardConfig?.writePermission || false
                },
                permittedHosts: permittedHosts
            });
            setShowEditModal(true);
        }
    };

    const handleDelete = async (authRecord: AuthRecord) => {
        if (authRecord.id === 'default') {
            toast.error('Cannot delete the default record');
            return;
        }

        if (window.confirm(`Are you sure you want to delete access for ${getStudentName(authRecord.id)}?`)) {
            try {
                await deleteTableItem('auth', authRecord.id, pid as string, hash as string);
                toast.success('Auth record deleted successfully');

                // Refresh data
                const [cl, rd] = buildColumnLabelsAndRowData(demoMode);
                setColumnLabels(cl);
                setRowData(rd);
            } catch (error) {
                console.error('Error deleting auth record:', error);
                toast.error('Failed to delete auth record');
            }
        }
    };

    const handleCopyLink = async (domainName: string, studentId: string, student?: Student | { first: string; last: string }) => {
        try {
            const accessLink = await authGetLink(domainName, studentId, pid as string, hash as string);
            if (typeof accessLink === 'string') {
                await navigator.clipboard.writeText(accessLink);
                const studentName = student ? `${student.first} ${student.last}` : 'Student';
                const appName = formatDomainForDisplay(domainName);
                toast.success(`Link copied for ${studentName} - ${appName}`);
            } else {
                toast.error('Failed to generate access link');
            }
        } catch (error) {
            console.error('Error copying access link:', error);
            toast.error('Failed to copy access link');
        }
    };

    const handleSaveAuthRecord = async () => {
        try {
            // Check if student profile fields have changed
            const studentChanges: Record<string, any> = {};
            Object.keys(formData.studentProfile).forEach(key => {
                const currentValue = formData.studentProfile[key as keyof typeof formData.studentProfile];
                const shadowValue = formData.shadowValues[key as keyof typeof formData.shadowValues];
                if (currentValue !== shadowValue) {
                    studentChanges[key] = currentValue;
                }
            });

            // Update student record if there are changes
            if (Object.keys(studentChanges).length > 0) {
                for (const [field, value] of Object.entries(studentChanges)) {
                    await updateStudentField(formData.studentId, field, value);
                }

                // Update local student data
                const studentIndex = allStudents.findIndex(s => s.id === formData.studentId);
                if (studentIndex !== -1) {
                    allStudents[studentIndex] = { ...allStudents[studentIndex], ...studentChanges };
                }
            }

            // Update auth record
            const authRecord: AuthRecord = {
                id: formData.studentId,
                adminDashboardConfig: formData.adminDashboardConfig,
                'permitted-hosts': formData.permittedHosts
            };

            await authPutAuthItem(authRecord, pid as string, hash as string);

            // Update the local copy of allAuthRecords
            const existingIndex = allAuthRecords.findIndex(ar => ar.id === formData.studentId);
            if (existingIndex >= 0) {
                allAuthRecords[existingIndex] = authRecord;
            } else {
                allAuthRecords.push(authRecord);
            }

            const successMessage = Object.keys(studentChanges).length > 0
                ? 'Student profile and auth record saved successfully'
                : 'Auth record saved successfully';
            toast.success(successMessage);

            setShowEditModal(false);

            // Refresh data
            const [cl, rd] = buildColumnLabelsAndRowData(demoMode);
            setColumnLabels(cl);
            setRowData(rd);
        } catch (error) {
            console.error('Error saving records:', error);
            toast.error('Failed to save records');
        }
    };

    const handleTogglePermittedHost = (host: string) => {
        setFormData(prev => ({
            ...prev,
            permittedHosts: prev.permittedHosts.includes(host)
                ? prev.permittedHosts.filter(h => h !== host)
                : [...prev.permittedHosts, host]
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

                // Calculate version
                calculateVersion();

                // Fetch all data in parallel
                const [students, authRecords, pools, viewsProfiles] = await Promise.all([
                    fetchStudents(),
                    fetchAuthRecords(),
                    fetchPools(),
                    fetchViewsProfiles()
                ]);

                // Defensive coding: ensure we have arrays before processing
                const studentsArray = Array.isArray(students) ? students : [];
                const authRecordsArray = Array.isArray(authRecords) ? authRecords : [];
                const poolsArray = Array.isArray(pools) ? pools : [];
                const viewsProfilesArray = Array.isArray(viewsProfiles) ? viewsProfiles : [];

                // Set global variables
                allStudents = studentsArray;
                allAuthRecords = authRecordsArray;
                allPools = poolsArray;
                allViewsProfiles = viewsProfilesArray;

                console.log('Data loaded - Students:', studentsArray.length, 'Auth Records:', authRecordsArray.length);

                // Fetch config values
                const appListConfig = await fetchConfig('accessManagerAppList');
                const poolConfig = await fetchConfig('accessManagerPool');
                const demoModeConfig = await fetchConfig('demoMode');

                if (appListConfig) {
                    accessManagerAppList = Array.isArray(appListConfig.value) ? appListConfig.value : [];
                }
                if (poolConfig) {
                    accessManagerPool = poolConfig.value || '';
                }

                // Calculate demo mode value
                let isDemoMode = false;
                if (demoModeConfig) {
                    console.log('Demo mode config:', demoModeConfig);
                    console.log('Demo mode value:', demoModeConfig.value);
                    console.log('Demo mode value type:', typeof demoModeConfig.value);
                    isDemoMode = demoModeConfig.value === 'true';
                    console.log('Setting demo mode to:', isDemoMode);
                    setDemoMode(isDemoMode);
                }

                // Calculate eligible students
                if (accessManagerPool && poolsArray.length > 0) {
                    eligibleStudents = studentsArray.filter(student => {
                        if (student.unsubscribe) return false;
                        return checkEligibility(accessManagerPool, student, 'student-manager', poolsArray);
                    });
                    eligibleStudents.sort(compareNames);
                } else {
                    eligibleStudents = studentsArray.filter(student => !student.unsubscribe);
                    eligibleStudents.sort(compareNames);
                }

                // Set current user information after students are loaded
                fetchCurrentUser(studentsArray);

                // Build initial table data
                const [cl, rd] = buildColumnLabelsAndRowData(isDemoMode);
                setColumnLabels(cl);
                setRowData(rd);

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

    // Loading display
    if (!loaded) {
        const progress = loadingProgress.total > 0
            ? Math.min(100, Math.round((loadingProgress.current / loadingProgress.total) * 100))
            : 0;

        return (
            <div className="loading-container" style={{ marginTop: '70px', minHeight: '400px', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: '100px' }}>
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <h1 style={{ fontSize: '32px', marginBottom: '20px', display: 'block', color: 'white', fontWeight: 'bold' }}>
                        Student Manager
                    </h1>
                    <b style={{ fontSize: '24px', marginBottom: '10px', display: 'block', color: 'white' }}>
                        {loadingProgress.message || 'Loading...'}
                    </b>
                    <Spinner animation="border" role="status" style={{ color: '#ffc107', width: '3rem', height: '3rem' }} />
                </div>

                {loadingProgress.current > 0 && (
                    <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
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
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '10px',
                            overflow: 'hidden',
                            border: '1px solid rgba(255,255,255,0.2)'
                        }}>
                            <div style={{
                                width: `${Math.min(100, (loadingProgress.current / loadingProgress.total) * 100)}%`,
                                height: '25px',
                                background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.8), rgba(255, 152, 0, 0.8))',
                                borderRadius: '10px',
                                transition: 'width 0.3s ease'
                            }}></div>
                        </div>
                    </div>
                )}
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
                            <div className="navbar-item">
                                <h2 style={{ color: 'white', margin: 0 }}>Student Manager</h2>
                            </div>
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
                    onCellClicked={handleCellClicked}
                    loading={!loaded}
                    itemCount={itemCount}
                    currentUserName={currentUserName}
                    version={version}
                    onCheckboxChanged={handleCheckboxChanged}
                    canWriteViews={true}
                />
            </Container>

            {/* Edit Modal */}
            <Modal show={showEditModal} onHide={() => { setShowEditModal(false); }} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>
                        Edit Access
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Control
                                        type="text"
                                        value={selectedStudent ? `${selectedStudent.first} ${selectedStudent.last}` : ''}
                                        readOnly
                                        style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <div style={{
                            border: '1px solid #555',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            backgroundColor: '#1a1a1a'
                        }}>
                            <h5 style={{ marginBottom: '20px' }}>Student Profile</h5>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>First Name</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={formData.studentProfile.first}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                studentProfile: {
                                                    ...prev.studentProfile,
                                                    first: e.target.value
                                                }
                                            }))}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Last Name</Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={formData.studentProfile.last}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                studentProfile: {
                                                    ...prev.studentProfile,
                                                    last: e.target.value
                                                }
                                            }))}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Email</Form.Label>
                                        <Form.Control
                                            type="email"
                                            value={demoMode ? 'xxxxxxxxxx' : formData.studentProfile.email}
                                            onChange={(e) => {
                                                if (!demoMode) {
                                                    setFormData(prev => ({
                                                        ...prev,
                                                        studentProfile: {
                                                            ...prev.studentProfile,
                                                            email: e.target.value
                                                        }
                                                    }));
                                                }
                                            }}
                                            disabled={demoMode}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Written Language Preference</Form.Label>
                                        <Form.Select
                                            value={formData.studentProfile.writtenLangPref || 'English'}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                studentProfile: {
                                                    ...prev.studentProfile,
                                                    writtenLangPref: e.target.value
                                                }
                                            }))}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        >
                                            {LANGUAGE_OPTIONS.map(lang => (
                                                <option key={lang} value={lang}>
                                                    {lang}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Spoken Language Preference</Form.Label>
                                        <Form.Select
                                            value={formData.studentProfile.spokenLangPref || 'English'}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                studentProfile: {
                                                    ...prev.studentProfile,
                                                    spokenLangPref: e.target.value
                                                }
                                            }))}
                                            style={{ backgroundColor: '#2b2b2b', color: 'white', border: '1px solid #555' }}
                                        >
                                            {LANGUAGE_OPTIONS.map(lang => (
                                                <option key={lang} value={lang}>
                                                    {lang}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                            </Row>
                        </div>

                        <div style={{
                            border: '1px solid #555',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            backgroundColor: '#1a1a1a'
                        }}>
                            <h5 style={{ marginBottom: '20px' }}>Admin Dashboard Configuration</h5>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Views Profile</Form.Label>
                                        <Form.Select
                                            value={formData.adminDashboardConfig.viewsProfile}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                adminDashboardConfig: {
                                                    ...prev.adminDashboardConfig,
                                                    viewsProfile: e.target.value
                                                }
                                            }))}
                                            disabled={!formData.permittedHosts.includes('admin-dashboard.slsupport.link')}
                                            style={{
                                                backgroundColor: formData.permittedHosts.includes('admin-dashboard.slsupport.link') ? '#2b2b2b' : '#1a1a1a',
                                                color: 'white',
                                                border: '1px solid #555'
                                            }}
                                        >
                                            <option value="">Select a views profile...</option>
                                            {allViewsProfiles.map(profile => (
                                                <option key={profile.id} value={profile.id}>
                                                    {profile.id}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                            </Row>

                            <Row>
                                <Col md={3}>
                                    <Form.Check
                                        type="checkbox"
                                        label="Write Permission"
                                        checked={formData.adminDashboardConfig.writePermission}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev,
                                            adminDashboardConfig: {
                                                ...prev.adminDashboardConfig,
                                                writePermission: e.target.checked
                                            }
                                        }))}
                                        disabled={!formData.permittedHosts.includes('admin-dashboard.slsupport.link')}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Check
                                        type="checkbox"
                                        label="Export CSV"
                                        checked={formData.adminDashboardConfig.exportCSV}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev,
                                            adminDashboardConfig: {
                                                ...prev.adminDashboardConfig,
                                                exportCSV: e.target.checked
                                            }
                                        }))}
                                        disabled={!formData.permittedHosts.includes('admin-dashboard.slsupport.link')}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Check
                                        type="checkbox"
                                        label="Student History"
                                        checked={formData.adminDashboardConfig.studentHistory}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev,
                                            adminDashboardConfig: {
                                                ...prev.adminDashboardConfig,
                                                studentHistory: e.target.checked
                                            }
                                        }))}
                                        disabled={!formData.permittedHosts.includes('admin-dashboard.slsupport.link')}
                                    />
                                </Col>
                            </Row>
                        </div>

                        <div style={{
                            border: '1px solid #555',
                            borderRadius: '8px',
                            padding: '20px',
                            backgroundColor: '#1a1a1a'
                        }}>
                            <h5 style={{ marginBottom: '20px' }}>Permitted Apps</h5>
                            <Row>
                                {accessManagerAppList.map(app => (
                                    <Col md={6} key={app} className="mb-2">
                                        <Form.Check
                                            type="checkbox"
                                            label={formatDomainForDisplay(app)}
                                            checked={formData.permittedHosts.includes(app)}
                                            onChange={() => handleTogglePermittedHost(app)}
                                        />
                                    </Col>
                                ))}
                            </Row>
                        </div>
                    </Form >
                </Modal.Body >
                <Modal.Footer style={{ borderTop: 'none' }}>
                    <Button variant="secondary" onClick={() => { setShowEditModal(false); }}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={handleSaveAuthRecord}>
                        Save
                    </Button>
                </Modal.Footer>
            </Modal >
        </>
    );
};

export default Home; 