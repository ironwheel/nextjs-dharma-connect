/**
 * @file pages/index.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Main page for the nextjs-dharma-connect/student-dashboard project, displaying events, videos, and other content
 * based on user eligibility and preferences. Handles user authentication status,
 * data fetching via /api/db and /api/auth, and dynamic content rendering.
 */
import React, { useState, useEffect, useCallback, Fragment, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Card, Button } from "react-bootstrap";
import { publicIpv4 } from 'public-ip';
import packageJson from '../package.json';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faPlus, faMinus, faTimes, faPlusCircle, faMinusCircle, faUser, faCheck, faXmark } from "@fortawesome/pro-solid-svg-icons";
import Navbar from "react-bootstrap/Navbar";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import FormControl from "react-bootstrap/FormControl";
import { ToastContainer, toast } from 'react-toastify';
import { AgGridReact } from 'ag-grid-react';
import { isMobile } from 'react-device-detect'
import Spinner from 'react-bootstrap/Spinner';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'react-toastify/dist/ReactToastify.css';

// Shared utilities and components using '@/' alias
import { getFingerprint } from '@dharma/shared';
import { dbgOut as studentDbgOut, dbgPrompt as studentDbgPrompt, dbgout as studentDbgout } from '@dharma/shared';
import {
  promptLookup,
  promptLookupHTML,
  promptLookupAIDSpecific,
  promptLookupDescription,
  promptLookupHTMLWithArgs,
  promptLookupHTMLWithArgsAIDSpecific
} from '@dharma/shared';
import { TopNavBar, BottomNavBar } from "@dharma/shared";
import { eligible } from '@dharma/shared';
import { CSRF_HEADER_NAME } from '@dharma/backend-core'; // Import CSRF header name


// Module-level variables
let masterPrompts = [];
let displayPrompts = [];
let allEvents = [];
let filteredEvents = [];
let allPools = [];
let allParticipants = [];
let eligibleParticipants = [];
let allTransactions = [];
var g_editable = false;
var g_row = 0;
var g_column = 0;
var g_offeringColumns = []
var columnMetaData = {}
var eventNames = []
var currentEvent = null
let student = null;
let searchTerm = ""
let gridAPI = false
let views = [
  "Joined",
  "Eligible",
  "Interpretation",
  "Not Offering",
  "Motivations",
  "Not Accepted",
  "Offering",
  "Bodhisattvas",
  "Mahayana",
  "Vajrayana",
  "Vajrayana One",
  "Vajrayana Two",
  "Abhisheka",
  "Installments",
  "Motivations",
  "Kate"
];

const dbgOut = () => studentDbgOut(student);
const dbgPrompt = () => studentDbgPrompt(student);
const dbgout = (...args) => studentDbgout(student, ...args);
const dbgLocalHost = () => student && student.debug && student.debug.localHost;

const g_predefinedColumnDefinitions = {
  'rowIndex': { field: "#", pinned: 'left', valueGetter: "node.rowIndex + 1", width: 75 },
  'name': { field: "name", pinned: 'left', sortable: true },
  'first': { field: "first", pinned: 'left', sortable: true },
  'last': { field: "last", pinned: 'left', sortable: true },
  'spokenLanguage': { field: "spokenLanguage", sortable: true },
  'writtenLanguage': { field: "writtenLanguage", sortable: true },
  'accepted': { field: "accepted", headerName: "Accept", cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
  'allow': { field: "allow", headerName: "Allow", cellRenderer: 'checkboxRenderer', sortable: true, width: 85 },
  'email': { field: "email" },
  'notes': { field: "notes", editable: g_editable },
  'id': { field: "id", hide: true },
  'history': { field: "history", width: 100, hide: true },
  'emailRegSent': { field: "emailRegSent", headerName: "Reg email", width: 120, sortable: true },
  'emailAcceptSent': { field: "emailAcceptSent", headerName: "Accept email", width: 120, sortable: true },
  'emailZoomSent': { field: "emailZoomSent", headerName: "Zoom email", width: 120, sortable: true },
  'joined': { field: "joined", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
  'owyaa': { field: "owyaa" },
  'attended': { field: "attended", cellRenderer: 'checkboxRenderer', sortable: true },
  'withdrawn': { field: "withdrawn", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
  'deposit': { field: "deposit", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
  'offering': { field: "offering", sortable: true, width: 120 },
  'installmentsTotal': { field: 'installmentsTotal', headerName: "Total", sortable: true, width: 125 },
  'installmentsReceived': { field: 'installmentsReceived', headerName: "Received", sortable: true, width: 125 },
  'installmentsDue': { field: 'installmentsDue', headerName: "Balance", sortable: true, width: 125 },
  'installmentsRefunded': { field: 'installmentsRefunded', headerName: "Refunded", sortable: true, width: 125 },
  'installmentsLF': { field: "installmentsLF", headerName: "LF", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 },
}

// AG grid spreadsheet definitions
const g_columnLabels = {
  'eligible': [{ field: "name", pinned: 'left', sortable: true }, { field: "history", width: 100, hide: true }, { field: "email", sortable: true, width: 150 }, { field: "reg sent", sortable: true, width: 125 }, { field: "allow", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "joined", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "accepted", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "offering", sortable: true, width: 100 }, { field: "attended", cellRenderer: 'checkboxRenderer', sortable: true }, { field: "language", sortable: true }, { field: "email" }, { field: "id", hide: true }],
  'withdrawn': [{ field: "name", pinned: 'left', sortable: true }, { field: "history", width: 100, hide: true }, { field: "withdrawn", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "deposit", sortable: true, width: 100 }, { field: "email" }, { field: "id", hide: true }],
  'not accepted': [{ field: "name", pinned: 'left', sortable: true }, { field: "accepted", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "notes", editable: g_editable }, { field: "country", sortable: true }, { field: "refuge vow", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "bodhi vow", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "supplicating for BV", cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, { field: "language", sortable: true }, { field: "ref1Name" }, { field: "ref1EMail" }, { field: "ref2Name" }, { field: "ref2EMail" }, { field: "email" }, { field: "id", hide: false }],
  'default': [{ field: "name", pinned: 'left', sortable: true }, { field: "history", width: 100, hide: true }, { field: "email", sortable: true, width: 150 }, { field: "id", hide: true }],
}

const g_viewConditions = {
  'default': [{ name: "currentAIDBool", boolName: "join", boolValue: true }, { name: "currentAIDBool", boolName: "withdrawn", boolValue: false }],
  'Monthly Summary': [],
  'Monthly Transactions': [],
}

const Home = () => {
  const router = useRouter();
  const { pid, hash } = router.query;

  const [loaded, setLoaded] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [name, setName] = useState("Unknown");
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [forceRenderValue, setForceRenderValue] = useState(0);
  const [csrfToken, setCsrfToken] = useState(null);
  const [currentEventAid, setCurrentEventAid] = useState('admin-dashboard');
  const [value, setValue] = useState(false)
  const [errMsg, setErrMsg] = useState(false)
  const [group, setGroup] = useState("")
  const [evShadow, setEvShadow] = useState(null)
  const [pools, setPools] = useState([])
  const [month, setMonth] = useState("May")
  const [year, setYear] = useState("2025")
  const [view, setView] = useState(null)
  const [itemCount, setItemCount] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [columnLabels, setColumnLabels] = useState([])
  const [rowData, setRowData] = useState([])
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState(null);
  const initialLoadStarted = useRef(false);

  // Component-specific helper functions
  const callDbApi = async (action, args = {}) => {
    try {
      // Ensure we have a CSRF token before making the request
      if (!csrfToken) {
        const tokenResponse = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getCsrfToken' })
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to get CSRF token');
        }

        const tokenResult = await tokenResponse.json();
        if (!tokenResult.data?.csrfToken) {
          throw new Error('No CSRF token in response');
        }

        setCsrfToken(tokenResult.data.csrfToken);
      }

      const response = await fetch('/api/db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken && { [CSRF_HEADER_NAME]: csrfToken })
        },
        body: JSON.stringify({
          action,
          payload: args
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.data?.err === 'CSRF_TOKEN_MISSING' || errorData.data?.err === 'CSRF_TOKEN_MISMATCH') {
          // If CSRF token is invalid, clear it and retry once
          setCsrfToken(null);
          return callDbApi(action, args);
        }
        throw new Error(errorData.data?.err || `API call failed with status ${response.status}`);
      }

      const result = await response.json();

      // Return the data property if it exists, otherwise return the whole result
      return result?.data || result;
    } catch (error) {
      console.error(`Error in callDbApi(${action}):`, error);
      throw error;
    }
  };

  const sendConfirmationEmail = async (pid, aid) => {
    try {
      console.log('Sending confirmation email with:', { pid, aid });
      const ip = await publicIpv4();
      const fingerprint = await getFingerprint();
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendConfirmationEmail',
          pid,
          aid,
          ip,
          fingerprint,
          url: window.location.hostname
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.data?.err || `Confirmation email request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error sending confirmation email:', error);
      throw error;
    }
  };

  const forceRender = useCallback(() => setForceRenderValue(v => v + 1), []);
  const updateDisplayPrompts = useCallback(() => { displayPrompts = [...masterPrompts]; }, []);
  const fetchStudentData = (currentPid) => callDbApi('findParticipant', { id: currentPid });
  const fetchPools = () => callDbApi('getPools', {});
  const fetchEvents = () => callDbApi('getEvents', {});
  const fetchView = (viewName) => callDbApi('getView', { name: viewName });
  const fetchConfig = (configName) => callDbApi('getConfig', { key: configName });

  const fetchPrompts = async (aid) => {
    console.log('Fetching prompts for AID:', aid);
    try {
      const result = await callDbApi('getPrompts', { aid });
      return result;
    } catch (error) {
      console.error('Error fetching prompts:', error);
      return [];
    }
  };
  const fetchParticipants = async (pid) => {
    try {
      let accumulateParticipants = [];
      let lastEvaluatedKey = null;

      // Add dev mode check - if true, only fetch one chunk
      const isDevMode = true;
      const maxChunks = isDevMode ? 1 : Infinity;

      let chunkCount = 0;
      do {
        const response = await callDbApi('getParticipants', {
          limit: 100,
          lastEvaluatedKey: lastEvaluatedKey
        });

        if (response.items) {
          accumulateParticipants = [...accumulateParticipants, ...response.items];
          setLoadingProgress(prev => ({
            ...prev,
            current: prev.current + response.items.length
          }));
        }
        lastEvaluatedKey = response.lastEvaluatedKey;
        chunkCount++;
      } while (lastEvaluatedKey && chunkCount < maxChunks);

      return accumulateParticipants;
    } catch (error) {
      console.error('Error fetching participants:', error);
      setErrMsg('Failed to fetch participants');
      return [];
    }
  };

  const verifyAccess = async (pid, token) => {
    try {
      const ip = await publicIpv4();
      const fingerprint = await getFingerprint();
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verifyAccess',
          pid,
          token,
          ip,
          fingerprint
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.data?.err || `Access verification failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error verifying access:', error);
      throw error;
    }
  };

  const checkAccess = async (pid, hash, url) => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'handleCheckAccess',
          pid,
          hash,
          url
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.data?.err || `Access check failed with status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error in checkAccess:', error);
      throw error;
    }
  };

  async function loadInitialData() {
    try {
      if (!pid) {
        setLoadingProgress(prev => ({ ...prev, message: "No PID provided in URL." }));
        return;
      }
      if (!hash) {
        setLoadingProgress(prev => ({ ...prev, message: "No HASH provided in URL." }));
        setLoaded(true);
        return;
      }
      try {
        await checkAccess(pid, hash, window.location.hostname);
      } catch (error) {
        console.log('checkAccess() catch: Error in checkAccess:', error);
        setLoadingProgress(prev => ({ ...prev, message: `Access error: ${error?.message || 'Unknown error'}` }));
        setLoaded(true);
        console.log('checkAccess() catch complete');
        return;
      }

      let token = localStorage.getItem('token');
      setCurrentEventAid('admin-dashboard');

      // First, try to get basic prompts without a session token
      setLoadingProgress({ current: 0, total: 0, message: "Loading basic information..." });
      try {
        masterPrompts = await fetchPrompts(currentEventAid);
        if (masterPrompts.length === 0) {
          console.warn("No prompts loaded, but continuing with initialization");
        }
        updateDisplayPrompts();
      } catch (error) {
        console.error("Error fetching prompts:", error);
        setLoadingProgress(prev => ({ ...prev, message: "Warning: Could not load prompts, but continuing..." }));
      }

      // If no session token, request email verification
      if (!token) {
        setLoadingProgress(prev => ({ ...prev, message: "Requesting email verification..." }));
        try {
          const confirmResp = await sendConfirmationEmail(pid, 'dashboard');
          if (confirmResp.data?.err) {
            throw new Error(`Confirmation email error: ${confirmResp.data.err}`);
          }
          setVerifyEmail(confirmResp.data || 'unknown email');
          setLoaded(true);
          return;
        } catch (error) {
          console.error("Error sending confirmation email:", error);
          setLoadingProgress(prev => ({ ...prev, message: `Error: ${error.message}.` }));
          return;
        }
      }

      // If we have a token, proceed with full initialization
      setLoadingProgress(prev => ({ ...prev, message: "Initializing secure session..." }));
      let initialCsrfToken = null;
      try {
        initialCsrfToken = await ensureCsrfToken();
      } catch (error) {
        console.error("Failed to initialize CSRF token:", error);
        throw error;
      }

      // Continue with the rest of the initialization...
      setLoadingProgress(prev => ({ ...prev, message: "Verifying access..." }));
      const verifyResponse = await verifyAccess(pid, token);
      console.log("verifyAccess response:", verifyResponse);

      if (verifyResponse?.data?.err === 'INVALID_SESSION_TOKEN') {
        console.warn(`Invalid session token detected: ${verifyResponse.data.reason}. Requesting re-confirmation.`);
        initialCsrfToken = null; setCsrfToken(null);
        await writeStudentAccessVerifyError(pid, `INVALID_SESSION_TOKEN: ${verifyResponse.data.reason}`, initialCsrfToken).catch(e => console.error("Failed to log INVALID_SESSION_TOKEN error:", e));
        localStorage.removeItem('token');
        setLoadingProgress(prev => ({ ...prev, message: "Requesting new email verification..." }));
        student.writtenLangPref = queryLanguage || student.writtenLangPref;
        const confirmResp = await sendConfirmationEmail(pid, 'dashboard');
        if (confirmResp.data?.err) {
          await writeStudentConfirmError(pid, confirmResp.data.err, initialCsrfToken).catch(e => console.error("Failed to log confirmation email error:", e));
          throw new Error(`Confirmation email error: ${confirmResp.data.err}`);
        }
        setVerifyEmail(confirmResp.data || 'unknown email');
        setLoaded(true);
        return;
      }

      if (!verifyResponse || typeof verifyResponse.data === 'undefined' || verifyResponse.data.err) {
        console.error("Verification check returned unexpected structure or error:", verifyResponse);
        throw new Error(verifyResponse?.data?.err || "Verification check failed due to unexpected API response.");
      }

      console.log("Access token verified successfully.");
      initialCsrfToken = await ensureCsrfToken();

      setLoadingProgress(prev => ({ ...prev, message: "Fetching content data..." }));

      // First get pools and events
      const [poolsResult, eventsResult] = await Promise.all([fetchPools(), fetchEvents()]);
      allPools = poolsResult || [];
      allEvents = eventsResult || [];

      // Then get participants with progress tracking
      setLoadingProgress(prev => ({ ...prev, message: "Fetching participants..." }));
      const initialResponse = await callDbApi('getParticipantsCount');
      console.log('Initial response:', initialResponse);
      const totalCount = initialResponse.Count || 0;
      console.log('Total count:', totalCount);
      setLoadingProgress(prev => ({ ...prev, total: totalCount, current: 0 }));

      allParticipants = await fetchParticipants(pid);
      console.log('Final participants count:', allParticipants.length);
      setLoadingProgress(prev => ({ ...prev, current: totalCount }));

      filteredEvents = []
      for (const levent of allEvents) {
        if (levent.hide)
          continue;

        for (const [subEventName, obj] of Object.entries(levent.subEvents)) {
          var subEventString = Object.keys(levent.subEvents).length === 1 ? levent.name : levent.name + ' (' + subEventName + ')'
          subEventString = obj.date + " " + subEventString
          filteredEvents.push({ name: subEventString, subEvent: subEventName, aid: levent.aid, date: obj.date, config: levent.config })
        }
      }

      // TODO - filteredEvents.push({ name: 'All', subEvent: 'all', aid: 'all', date: '2999-12-31', config: null })

      filteredEvents.sort((a, b) => {
        if (a.date > b.date) return -1;
        if (a.date < b.date) return 1;
        return 0;
      });

      try {
        const aidData = await fetchConfig("adminDashboardLandingAID");
        const seData = await fetchConfig("adminDashboardLandingSubEvent");
        currentEvent = filteredEvents.find(o => o.aid === aidData.value && o.subEvent === seData.value);
      } catch (error) {
        console.error("Error getting landing config:", error);
      }

      eligibleParticipants = []
      console.log("ELIGIBLE LOAD START:", currentEvent.aid)
      allParticipants.forEach((item) => addEligible(item));
      eligibleParticipants.sort(compareNames);
      console.log("ELIGIBLE LOAD END:", eligibleParticipants.length)

      try {
        setView('Joined');
        const [cl, rd] = await assembleColumnLabelsAndRowData('Joined');
        setEvShadow(currentEvent);
        setColumnLabels(cl);
        setRowData(rd);
        setLoaded(true);
      } catch (error) {
        console.error('Error in assembleColumnLabelsAndRowData:', error);
      }
    } catch (error) {
      console.error("Initialization Error in loadInitialData:", error);
      setLoadingProgress(prev => ({ ...prev, message: `Error: ${error?.message || 'Unknown error'}. Please try refreshing.` }));
      setLoaded(true);
    }
  }

  const ensureCsrfToken = async () => {
    if (csrfToken) return csrfToken;
    const sessionToken = localStorage.getItem('token');
    if (!sessionToken) {
      console.log("No session token found, skipping CSRF token initialization");
      return null;
    }

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCsrfToken' })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errorMsg = `Failed to get CSRF token (${response.status}): ${errData.data?.err || response.statusText}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      const result = await response.json();
      if (!result.data?.csrfToken) {
        const errorMsg = "CSRF token not found in response from getCsrfToken.";
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      setCsrfToken(result.data.csrfToken);
      return result.data.csrfToken;
    } catch (error) {
      console.error("Error fetching initial CSRF token:", error);
      setLoadStatus(`Error initializing secure session: ${error.message}. Try refreshing.`);
      throw error;
    }
  };

  // Main initialization effect
  useEffect(() => {
    if (!router.isReady) return;
    const { pid, hash } = router.query;
    if (verifyEmail || initialLoadStarted.current || !pid) return;

    initialLoadStarted.current = true;
    loadInitialData().catch((err) => {
      console.error('Unhandled error in loadInitialData:', err);
      setLoadingProgress(prev => ({ ...prev, message: `Fatal error: ${err?.message || 'Unknown error'}` }));
      setLoaded(true);
    });
  }, [router.isReady, pid, verifyEmail]);

  function headerHeightGetter() {
    var columnHeaderTexts = [
      ...document.querySelectorAll('.ag-header-cell-text'),
    ];
    var clientHeights = columnHeaderTexts.map(
      headerText => headerText.clientHeight
    );
    var tallestHeaderTextHeight = Math.max(...clientHeights);

    return tallestHeaderTextHeight;
  }

  const writeParticipantAID = async (id, aid) => {
    try {
      const result = await callDbApi('writeParticipantAID', {
        id,
        aid
      });

      if (!result) {
        throw new Error('Failed to write participant AID');
      }

      return result;
    } catch (error) {
      console.error('Error in writeParticipantAID:', error);
      throw error;
    }
  };

  const writeParticipantAIDField = async (id, aid, field, value) => {
    try {
      const result = await callDbApi('writeAIDField', {
        id,
        aid,
        field,
        value
      });

      if (!result) {
        throw new Error('Failed to write AID field');
      }

      return result;
    } catch (error) {
      console.error('Error in writeParticipantAIDField:', error);
      throw error;
    }
  };

  const writeParticipantOWYAALease = async (id, timestamp) => {
    try {
      const response = await fetch('/api/writeParticipantOWYAALease', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id,
          timestamp
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error writing participant OWYAA lease:', error);
      throw error;
    }
  };

  const writeStudentAccessVerifyError = async (pid, errorString, errorTime) => {
    try {
      const response = await fetch('/api/writeStudentAccessVerifyError', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id: pid,
          errorString,
          errorTime
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error writing student access verify error:', error);
      throw error;
    }
  };

  const Footer = () => {

    if (group !== 'Finance' && group !== 'Primary' && group !== 'SLST') {
      return (
        <>
          <Navbar style={{ fontSize: 14 }} bg="light" fixed="bottom" variant="light" expand="lg">
            <Form inline="true"><i>{" "}View: {itemCount}, Eligible: {eligibleParticipants.length}, All: {allParticipants.l}</i></Form>
          </Navbar>
        </>
      )
    } else {
      return (
        <>
          <Navbar style={{ fontSize: 14 }} bg="light" fixed="bottom" variant="light" expand="lg">
            <Form inline="true"><i>{" "}View: {itemCount}, Eligible: {eligibleParticipants.length}, All: {allParticipants.length}, Transactions: {allTransactions.length}</i></Form>
          </Navbar>
        </>
      )
    }
  }

  const addEligible = (el) => {

    if (el.unsubscribe) {
      return
    }

    if (currentEvent.aid === 'all') {
      el.searchDisplayName = el.first + ' ' + el.last
      eligibleParticipants.push(el)
      return
    }

    if (eligible(currentEvent.config.pool, el, currentEvent.aid, allPools))
      eligibleParticipants.push(el)
  }

  const compareNames = (a, b) => {
    if (a.first + a.last < b.first + b.last) return -1;
    if (a.first + a.last > b.first + b.last) return 1;
    return 0;
  }

  const PlainSearchHeader = () => {

    const handleSearch = async (e) => {
      console.log("handleSearch:", e)
      setSearchTerm(e)
      const [cl, rd] = await assembleColumnLabelsAndRowData(view, month, year)
      setColumnLabels(cl)
      setRowData(rd)
    }

    const handleCSVExport = () => {
      console.log("handleCSVExport")
      gridAPI.exportDataAsCsv();
      setValue(value + 1)
    }

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (e.key === "Enter") {
        let searchTermValue = document.getElementById("searchInput").value;
        setSearchTerm(searchTermValue);
        const [cl, rd] = await assembleColumnLabelsAndRowData(view, month, year);
        setColumnLabels(cl);
        setRowData(rd);
      } else {
        document.getElementById("searchInput").value += e.key;
      }
    }

    const ConditionalSearchInput = () => {
      if (searchTerm === "") {
        return (
          <Form.Control
            inline="true"
            onKeyPress={handleSubmit}
            id='searchInput'
            type="search"
            placeholder="Search"
            className="me-2"
            aria-label="Search"
            style={{ minWidth: 120, maxWidth: 220 }}
          />
        )
      } else {
        return (
          <Form.Control
            inline="true"
            onKeyPress={handleSubmit}
            id='searchInput'
            type="search"
            defaultValue={searchTerm}
            className="me-2 flex-grow-1"
            aria-label="Search"
            style={{ minWidth: 200 }}
          />
        )
      }
    }

    return (
      <Navbar sticky="top" bg="primary" variant="dark" expand="lg" style={{ fontSize: 18 }}>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <div className="d-flex flex-wrap align-items-center w-100 gap-2">
          <div style={{ minWidth: 500 }} className="me-2"><EventSelection /></div>
          <div style={{ minWidth: 180 }} className="me-2"><ViewSelection /></div>
          <div style={{ minWidth: 140 }} className="me-2"><MonthSelection /></div>
          <div style={{ minWidth: 140 }} className="me-2"><YearSelection /></div>
          <Form className="d-flex flex-grow-1 align-items-center" style={{ minWidth: 200 }}>
            <ConditionalSearchInput />
            <Button
              className="ms-2"
              style={{ width: "auto", whiteSpace: "nowrap", padding: "0.375rem 0.75rem" }}
              onClick={() => handleSearch(document.getElementById("searchInput").value)}
              variant="success"
            >
              Search
            </Button>
          </Form>
          <Button
            className="ms-2"
            style={{ width: "auto", whiteSpace: "nowrap", padding: "0.375rem 0.75rem" }}
            onClick={handleCSVExport}
            variant="secondary"
          >
            Export CSV
          </Button>
          <div className="ms-2">{group}</div>
        </div>
      </Navbar>
    )
  }

  const waitForAIDFieldWrite = async (id, field, value) => {
    try {
      const result = await callDbApi('writeAIDField', {
        id,
        aid: currentEventAid,
        field,
        value
      });

      if (!result) {
        throw new Error('Failed to write AID field');
      }

      // Force a re-render to update the UI
      forceRender();
      return result;
    } catch (error) {
      console.error('Error in waitForAIDFieldWrite:', error);
      toast.error(`Failed to update field: ${error.message}`);
      throw error;
    }
  };

  const waitForAIDWhichRetreatsFieldWrite = async (id, field, value) => {
    writeParticipantAID(id, currentEvent.aid)
      .finally(() => {
        let objIndex = eligibleParticipants.findIndex((obj => obj.id === id));
        if (typeof eligibleParticipants[objIndex].programs[currentEvent.aid] === 'undefined') {
          eligibleParticipants[objIndex].programs[currentEvent.aid] = {}
        }
        if (typeof eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats === 'undefined') {
          eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats = {}
        }
        eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats[field] = value
        writeParticipantAIDField(id, currentEvent.aid, 'whichRetreats', eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats)
          .then(() => {
            let name = eligibleParticipants[objIndex].first + ' ' + eligibleParticipants[objIndex].last
            toast.info('Setting Which Retreats ' + field + ' to "' + value + '" for ' + name, { autoClose: 3000 })
            setValue(value + 1)
          })
          .catch((err) => {
            console.log("waitForAIDWhichRetreatsFieldWrite() FAILS:", JSON.stringify(err))
          })
      })
  }

  const waitForAIDWhichRetreatsFieldWriteRadio = async (id, field) => {
    writeParticipantAID(id, currentEvent.aid)
      .finally(() => {
        let objIndex = eligibleParticipants.findIndex((obj => obj.id === id));
        if (typeof eligibleParticipants[objIndex].programs[currentEvent.aid] === 'undefined') {
          eligibleParticipants[objIndex].programs[currentEvent.aid] = {}
        }
        // uncheck everything else
        eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats = {}
        // check this field
        eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats[field] = true
        writeParticipantAIDField(id, currentEvent.aid, 'whichRetreats', eligibleParticipants[objIndex].programs[currentEvent.aid].whichRetreats)
          .then(() => {
            let name = eligibleParticipants[objIndex].first + ' ' + eligibleParticipants[objIndex].last
            toast.info('Setting Which Retreats ' + currentEvent.config.whichRetreatsConfig[field].headerName + ' to "true" for ' + name, { autoClose: 3000 })
            setValue(value + 1)
          })
          .catch((err) => {
            console.log("waitForAIDWhichRetreatsFieldWrite() FAILS:", JSON.stringify(err))
          })
      })
  }

  const CheckboxRenderer = (props) => {

    const checkedHandler = async (e) => {
      if (group === "Read Only" || group === "Primary") {
        toast.info('Value not changed. READ ONLY', { autoClose: 3000 })
        return
      }
      console.log("CheckboxRenderer PRE:", e.target.checked, props.data.name, props.colDef.field)
      if (props.colDef.field.startsWith('currentAIDMapBool') || props.colDef.field.startsWith('currentAIDBool') || props.colDef.field === 'allow' || props.colDef.field === 'installmentsLF' || props.colDef.field === 'attended' || props.colDef.field === 'accepted' || props.colDef.field === 'withdrawn' || props.colDef.field === 'joined') {
        // console.log("CheckboxRenderer IN:", e.target.checked, props.colDef.field)
        let checked = e.target.checked;
        let colId = props.column.colId;
        props.node.setDataValue(colId, checked);
        var dataField = props.colDef.field;
        if (props.colDef.field === 'joined') {
          dataField = 'join';
        }
        if (props.colDef.field === 'installmentsLF') {
          dataField = 'limitFee';
        }
        if (props.colDef.field.startsWith('currentAIDMapBool')) {
          dataField = columnMetaData[props.colDef.field].boolName
          console.log("CheckboxRenderer SET:", dataField)
          if (currentEvent.config.whichRetreatsRadio) {
            // can't uncheck radio retreats, have to check others
            if (e.target.checked) {
              // clear all other values in the whichRetreats field and check the requested value
              await waitForAIDWhichRetreatsFieldWriteRadio(props.data.id, dataField)
            }
          } else {
            // non-Radio retreats can have multiple selections
            await waitForAIDWhichRetreatsFieldWrite(props.data.id, dataField, e.target.checked)
          }
        } else {
          if (props.colDef.field.startsWith('currentAIDBool')) {
            dataField = columnMetaData[props.colDef.field].boolName
          }
          // console.log("CheckboxRenderer SET:", props.data.id, dataField, e.target.checked)
          await waitForAIDFieldWrite(props.data.id, dataField, e.target.checked)
        }
      }
      //const [cl, rd] = await assembleColumnLabelsAndRowData(view, e, year)
      //setColumnLabels(cl)
      //setRowData(rd)
    }

    const nullHandler = (e) => {
      // here to keep babel from freaking out
    }

    return (
      <input
        type="checkbox"
        onClick={(e) => checkedHandler(e)}
        onChange={nullHandler}
        checked={props.value}
      />
    )
  }

  const EventSelection = () => {

    const handleEventSelection = async (e) => {
      // look through the event list for the selected event
      currentEvent = filteredEvents.find(o => o.name === e)

      console.log("EventSelection:", currentEvent)
      let lview = view
      localStorage.setItem('event', JSON.stringify(currentEvent));
      eligibleParticipants = []
      console.log("ELIGIBLE LOAD START:", currentEvent.aid)
      allParticipants.forEach((item) => addEligible(item));
      eligibleParticipants.sort(compareNames);
      console.log("ELIGIBLE LOAD END:", eligibleParticipants.length)
      //setupOfferingColumns()
      setEvShadow(currentEvent)
      const [cl, rd] = await assembleColumnLabelsAndRowData(lview, month, year)
      setColumnLabels(cl)
      setRowData(rd)
    }

    var title
    if (currentEvent === null) {
      title = "Select Event"
    } else {
      console.log("event select render:", currentEvent.name, currentEvent.aid)
      title = currentEvent.name
    }

    return (
      <>
        <DropdownButton className="group" id="dropdown-basic-button" onSelect={(e) => handleEventSelection(e)} title={title} >
          {filteredEvents.map((el) => <Dropdown.Item key={el.name} eventKey={el.name}>{el.name}</Dropdown.Item>)}
        </DropdownButton>
      </>
    )
  }

  const ViewSelection = () => {

    const handleViewSelection = async (e) => {
      localStorage.setItem('view', e);
      console.log("ViewSelection:", e)
      //setupOfferingColumns()
      setView(e)
      const [cl, rd] = await assembleColumnLabelsAndRowData(e, month, year)
      setColumnLabels(cl)
      setRowData(rd)
    }

    const title = view || "Select View";

    return (
      <>
        <DropdownButton className="group" id="dropdown-basic-button" onSelect={(e) => handleViewSelection(e)} title={title} >
          {Object.values(views).map((viewName) => (
            <Dropdown.Item key={viewName} eventKey={viewName}>{viewName}</Dropdown.Item>
          ))}
        </DropdownButton>
      </>
    )
  }

  const MonthSelection = () => {

    const handleMonthSelection = async (e) => {
      localStorage.setItem('month', e);
      console.log("MonthSelection:", e)
      //eligibleParticipants = []
      setMonth(e);
      const [cl, rd] = await assembleColumnLabelsAndRowData(view, e, year)
      setColumnLabels(cl)
      setRowData(rd)
    }

    var title
    if (month === "") {
      title = "Select Month"
    } else {
      console.log("month select render:", month)
      title = month
    }

    if (group !== "Finance" && group !== "Primary") {
      return null;
    }

    return (
      <>
        <DropdownButton className="group" id="dropdown-basic-button" onSelect={(e) => handleMonthSelection(e)} title={title} >
          {g_months.map((m) => <Dropdown.Item key={m} eventKey={m}>{m}</Dropdown.Item>)}
        </DropdownButton>
      </>
    )
  }

  const YearSelection = () => {

    const handleYearSelection = async (e) => {
      localStorage.setItem('year', e);
      //eligibleParticipants = []
      setYear(e);
      const [cl, rd] = await assembleColumnLabelsAndRowData(view, month, e)
      setColumnLabels(cl)
      setRowData(rd)
    }

    var title
    if (year === "") {
      title = "Select Year"
    } else {
      console.log("year select render:", year)
      title = year
    }

    if (group !== "Finance" && group !== "Primary") {
      return null;
    }

    return (
      <>
        <DropdownButton className="group" id="dropdown-basic-button" onSelect={(e) => handleYearSelection(e)} title={title} >
          {g_years.map((y) => <Dropdown.Item key={y} eventKey={y}>{y}</Dropdown.Item>)}
        </DropdownButton>
      </>
    )
  }


  const escapeRegExp = (string) => {
    return string.replace(/([.*+?^=!:${}()|[\]/\\])/g, "\\$1");
  }

  const getRowValues = (viewConditions, columnLabels, el) => {

    //if (el.id.includes('test')) {
    //    return null;
    //}

    if (el.unsubscribe) {
      return null;
    }

    for (let i = 0; i < viewConditions.length; i++) {

      if (viewConditions[i].name === 'currentAIDBool') {
        if (typeof el.programs[currentEvent.aid] !== 'undefined' && typeof el.programs[currentEvent.aid][viewConditions[i].boolName] !== 'undefined') {
          if (el.programs[currentEvent.aid][viewConditions[i].boolName] !== viewConditions[i].boolValue) {
            return null
          }
        } else {
          // if this is supposed to be false, accept not existing as false
          if (viewConditions[i].boolValue) {
            return null
          }
        }
      } else if (viewConditions[i].name === 'currentAIDMapBool') {
        if (typeof el.programs[currentEvent.aid] !== 'undefined' && typeof el.programs[currentEvent.aid][viewConditions[i].map] !== 'undefined' &&
          typeof el.programs[currentEvent.aid][viewConditions[i].map][viewConditions[i].boolName] !== 'undefined') {
          if (el.programs[currentEvent.aid][viewConditions[i].map][viewConditions[i].boolName] !== viewConditions[i].boolValue) {
            return null
          }
        } else {
          if (viewConditions[i].boolValue) {
            return null
          }
        }
      } else if (viewConditions[i].name === 'baseBool') {
        if (typeof el[viewConditions[i].boolName] !== 'undefined') {
          if (el[viewConditions[i].boolName] !== viewConditions[i].boolValue) {
            return null
          }
        } else {
          if (viewConditions[i].boolValue) {
            return null
          }
        }
      } else if (viewConditions[i].name === 'practiceBool') {
        if (typeof el.practice[viewConditions[i].boolName] !== 'undefined') {
          if (el.practice[viewConditions[i].boolName] !== viewConditions[i].boolValue) {
            return null
          }
        } else {
          if (viewConditions[i].boolValue) {
            return null
          }
        }
      } else if (viewConditions[i].name === 'poolMember') {
        if (!eligible(viewConditions[i].pool, el, currentEvent.aid, allPools)) {
          return null
        }
      } else if (viewConditions[i].name === 'offering' || viewConditions[i].name === 'deposit') {
        let person = el.programs[currentEvent.aid]

        var installmentTotal = 0
        var installmentReceived = 0

        if (typeof person.offeringHistory !== 'undefined' && typeof person.offeringHistory[currentEvent.subEvent] !== 'undefined') {
          if (currentEvent.config.offeringPresentation !== 'installments') {
            // with non-installment events, offering and deposit have the same meaning
            if (!viewConditions[i].boolValue) {
              return null
            }
          } else {
            // this event accepts installments
            // offering means gave the full amount due
            // deposit means gave something
            // calculate the amount this person owes for the event depening on the retreats they're signed up for
            // limit this amount to 2 if limitFee is true
            let limitCount = 100
            let count = 0
            if (typeof person.limitFee !== 'undefined' && person.limitFee) {
              limitCount = 2
            }
            for (const [retreat, value] of Object.entries(person.whichRetreats)) {
              if (value) {
                installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal
                count += 1
                if (count >= limitCount) {
                  break
                }
              }
            }
            for (const [installmentName, installmentEntry] of Object.entries(person.offeringHistory[currentEvent.subEvent].installments)) {
              installmentReceived += installmentEntry.offeringAmount
            }
            if (installmentReceived === 0) {
              // same for both offering and deposit having offered nothing means the same thing
              if (viewConditions[i].boolValue) {
                return null
              }
            } else {
              // something received, deposit is automatically true
              if (viewConditions[i].name === 'deposit') {
                if (!viewConditions[i].boolValue) {
                  return null
                }
              } else {
                // for offering see if it's everything
                if (installmentReceived >= installmentTotal) {
                  if (!viewConditions[i].boolValue) {
                    return null
                  }
                } else {
                  if (viewConditions[i].boolValue) {
                    return null
                  }
                }
              }
            }
          }
        } else {
          // no offering history for this event
          if (viewConditions[i].boolValue) {
            return null
          }
        }
      } else if (viewConditions[i].name === 'spokenLanguage') {
        var spokenLanguage = "";
        if (typeof el.spokenLangPref === 'undefined') {
          spokenLanguage = "English"
        } else {
          spokenLanguage = el.spokenLangPref
        }
        let match = (viewConditions[i].stringValue === spokenLanguage);
        if (viewConditions[i].boolValue && !match) {
          return null
        }
        if (!viewConditions[i].boolValue && match) {
          return null
        }
      } else if (viewConditions[i].name === 'writtenLanguage') {
        var writtenLanguage = "";
        if (el.spokenTranslate && el.writtenLangPref !== "English") {
          writtenLanguage = el.writtenLangPref
        }
        if (writtenLanguage === "") {
          writtenLanguage = "English"
        }
        let match = (viewConditions[i].stringValue === writtenLanguage);
        if (viewConditions[i].boolValue && !match) {
          return null
        }
        if (!viewConditions[i].boolValue && match) {
          return null
        }
      } else {
        console.log("Unhandled view condition:", viewConditions[i].name)
      }
    }

    // reject those not in the search criteria if there is one
    if (searchTerm !== '') {
      console.log("searchTerm:", searchTerm)
      var tLanguage = "";
      if (typeof el.spokenLangPref === 'undefined') {
        tLanguage = ", " + el.writtenLangPref
      } else {
        tLanguage = ", " + el.spokenLangPref
      }

      // scan each list looking for the search term
      var lsearchTerm = searchTerm.toUpperCase();
      var regex = '\\b';
      regex += escapeRegExp(lsearchTerm);
      regex += '\\b';
      let searchBlob = el.first + " " + el.last + " " + el.country + " " + tLanguage + " " + el.email;

      if (!RegExp(regex, "i").test(searchBlob)) {
        return null;
      }
    }

    // assemble the row values from the provided map
    let rowValues = {}

    // console.log("NAME:", el.first + " " + el.last)
    var keys
    for (let i = 0; i < columnLabels.length; i++) {
      let field = columnLabels[i].field
      if (field === '#') {
        // automatically filled out
      } else if (field === 'id') {
        rowValues[field] = el.id
      } else if (field === 'name') {
        rowValues[field] = el.first + " " + el.last
      } else if (field === 'first') {
        rowValues[field] = el.first
      } else if (field === 'last') {
        rowValues[field] = el.last
      } else if (field === 'email') {
        rowValues[field] = el.email
      } else if (field === 'joined') {
        try {
          rowValues[field] = el.programs[currentEvent.aid].join
        } catch {
          rowValues[field] = false
        }
      } else if (field === 'accepted') {
        try {
          rowValues[field] = el.programs[currentEvent.aid].accepted
        } catch {
          rowValues[field] = false
        }
      } else if (field === 'allow') {
        try {
          rowValues[field] = el.programs[currentEvent.aid].allow
        } catch {
          rowValues[field] = false
        }
      } else if (field === 'withdrawn') {
        try {
          rowValues[field] = el.programs[currentEvent.aid].withdrawn
        } catch {
          rowValues[field] = false
        }
      } else if (field.includes('offeringCount')) {
        let count = 0
        if (typeof el.programs[columnMetaData[field].aid] !== 'undefined') {
          if (typeof el.programs[columnMetaData[field].aid].offeringHistory !== 'undefined') {
            let keys = Object.keys(el.programs[columnMetaData[field].aid].offeringHistory)
            count = keys.length
          }
        }
        rowValues[field] = count
      } else if (field.includes('poolMember')) {
        rowValues[field] = eligible(columnMetaData[field].pool, el, currentEvent.aid, allPools)
      } else if (field.includes('emailSent')) {
        try {
          rowValues[field] = el.emails[columnMetaData[field].campaign]
        } catch {
          rowValues[field] = ""
        }
      } else if (field.includes('currentAIDBool')) {
        try {
          rowValues[field] = el.programs[currentEvent.aid][columnMetaData[field].boolName]
        } catch {
          rowValues[field] = false
        }
      } else if (field.includes('specifiedAIDBool')) {
        try {
          rowValues[field] = el.programs[columnMetaData[field].aid][columnMetaData[field].boolName]
        } catch {
          rowValues[field] = false
        }
      } else if (field.includes('currentAIDMapBool')) {
        try {
          rowValues[field] = el.programs[currentEvent.aid][columnMetaData[field].map][columnMetaData[field].boolName]
        } catch {
          rowValues[field] = false
        }
      } else if (field.includes('currentAIDMapList')) {
        let listString = ""
        if (typeof el.programs[currentEvent.aid][columnMetaData[field].map] !== 'undefined') {
          for (const [name, value] of Object.entries(el.programs[currentEvent.aid][columnMetaData[field].map])) {
            if (value) {
              listString += name + ' '
            }
          }
        }
        rowValues[field] = listString
      } else if (field.includes('specifiedAIDMapBool')) {
        try {
          rowValues[field] = el.programs[columnMetaData[field].aid][columnMetaData[field].map][columnMetaData[field].boolName]
        } catch {
          rowValues[field] = false
        }
      } else if (field.includes('currentAIDString')) {
        try {
          rowValues[field] = el.programs[currentEvent.aid][columnMetaData[field].stringName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('specifiedAIDString')) {
        try {
          rowValues[field] = el.programs[columnLabels[i].aid][columnMetaData[field].stringName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('currentAIDNumber')) {
        try {
          rowValues[field] = el.programs[currentEvent.aid][columnMetaData[field].numberName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('specifiedAIDNumber')) {
        try {
          rowValues[field] = el.programs[columnLabels[i].aid][columnMetaData[field].numberName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('baseString')) {
        try {
          rowValues[field] = el[columnMetaData[field].stringName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('baseBool')) {
        try {
          rowValues[field] = el[columnMetaData[field].boolName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field.includes('practiceBool')) {
        try {
          rowValues[field] = el.practice[columnMetaData[field].boolName]
        } catch {
          rowValues[field] = "unknown"
        }
      } else if (field === 'emailRegSent') {
        let regSent
        try {
          regSent = el.emails[currentEvent.aid + '_' + currentEvent.subEvent + '_reg_EN'].substring(0, 10)
        } catch {
          regSent = ""
        }
        rowValues[field] = regSent
      } else if (field === 'emailAcceptSent') {
        let acceptSent
        try {
          acceptSent = el.emails[currentEvent.aid + '_' + currentEvent.subEvent + '_accept_EN'].substring(0, 10)
        } catch {
          acceptSent = ""
        }
        rowValues[field] = acceptSent
      } else if (field === 'emailZoomSent') {
        let zoomSent
        try {
          zoomSent = el.emails[currentEvent.aid + '_' + currentEvent.subEvent + '_reg_confirm_EN'].substring(0, 10);
        } catch {
          zoomSent = ""
        }
        rowValues[field] = zoomSent
      } else if (field === 'owyaa') {

        const diffTime = (_datetime) => {
          var datetime = new Date(_datetime).getTime();
          var now = new Date().getTime();
          var millisec_diff = 0

          if (isNaN(datetime)) {
            return 9999;
          }

          if (datetime < now) {
            millisec_diff = now - datetime;
          } else {
            millisec_diff = datetime - now;
          }

          return Math.floor(millisec_diff / 1000 / 60 / (60 * 24));
        }

        var owyaaDays = -1
        if (typeof el.owyaaLease !== 'undefined') {
          owyaaDays = diffTime(el.owyaaLease)
        }

        var owyaaText
        if (owyaaDays !== -1) {
          if (owyaaDays > 90) {
            owyaaDays = 90;
          }
          owyaaText = "OWYAA Days Left: " + (90 - owyaaDays).toString()
        } else {
          owyaaText = "Enable OWYAA"
        }

        rowValues[field] = owyaaText
      } else if (field === 'offering' || field === 'deposit') {
        let person = el.programs[currentEvent.aid]

        var offering = false
        var offeringDate = ""
        var installmentTotal = 0
        var installmentReceived = 0

        if (typeof person.offeringHistory !== 'undefined' && typeof person.offeringHistory[currentEvent.subEvent] !== 'undefined') {
          if (currentEvent.config.offeringPresentation !== 'installments') {
            offering = true
            offeringDate = person.offeringHistory[currentEvent.subEvent].offeringTime.substring(0, 10)
          } else {
            // this event accepts installments
            // offering means gave the full amount due
            // deposit means gave something
            // calculate the amount this person owes for the event depening on the retreats they're signed up for
            // limit this amount to 2 if limitFee is true
            let limitCount = 100
            let count = 0
            if (typeof person.limitFee !== 'undefined' && person.limitFee) {
              limitCount = 2
            }
            for (const [retreat, value] of Object.entries(person.whichRetreats)) {
              if (value) {
                installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal
                count += 1
                if (count >= limitCount) {
                  break
                }
              }
            }
            let lastOfferingTime = ""
            for (const [installmentName, installmentEntry] of Object.entries(person.offeringHistory[currentEvent.subEvent].installments)) {
              if (installmentName !== 'refunded') {
                installmentReceived += installmentEntry.offeringAmount
                lastOfferingTime = installmentEntry.offeringTime
              }
            }
            if (installmentReceived === 0) {
              // same for both offering and deposit having offered nothing means the same thing
              offering = false
            } else {
              // something received, deposit is automatically true
              if (field === 'deposit') {
                offering = true
                offeringDate = lastOfferingTime.substring(0, 10)
              } else {
                // for offering see if it's everything
                if (installmentReceived >= installmentTotal) {
                  offering = true
                  offeringDate = lastOfferingTime.substring(0, 10)
                } else {
                  offering = false
                }
              }
            }
          }
        }
        rowValues[field] = offeringDate
      } else if (field === 'spokenLanguage') {
        var spokenLanguage = "";
        if (typeof el.spokenLangPref === 'undefined') {
          spokenLanguage = el.writtenLangPref
        } else {
          spokenLanguage = el.spokenLangPref
        }
        if (spokenLanguage === 'English') {
          spokenLanguage = "";
        }
        rowValues[field] = spokenLanguage
      } else if (field === 'writtenLanguage') {
        var writtenLanguage = "";
        if (el.spokenTranslate && el.writtenLangPref !== "English") {
          writtenLanguage = el.writtenLangPref
        }
        if (writtenLanguage === 'English') {
          writtenLanguage = "";
        }
        rowValues[field] = writtenLanguage
      } else if (field === 'history') {
        rowValues[field] = "https://dashboard.slsupport.link/?pid=" + el.id
      } else if (field === 'installmentsTotal' || field === 'installmentsReceived' || field === 'installmentsDue' || field === 'installmentsRefunded') {
        let person = el.programs[currentEvent.aid]
        var installmentTotal = 0
        var installmentReceived = 0
        var installmentRefunded = 0

        if (currentEvent.config.offeringPresentation !== 'installments') {
          rowValues[field] = 999
        } else {
          // this event accepts installments
          // offering means gave the full amount due
          // deposit means gave something
          // calculate the amount this person owes for the event depening on the retreats they're signed up for
          // limit this amount to 2 if limitFee is true
          let limitCount = 100
          let count = 0
          if (typeof person.limitFee !== 'undefined' && person.limitFee) {
            limitCount = 2
          }
          for (const [retreat, value] of Object.entries(person.whichRetreats)) {
            if (value) {
              installmentTotal += currentEvent.config.whichRetreatsConfig[retreat].offeringTotal
              count += 1
              if (count >= limitCount) {
                break
              }
            }
          }
          if (field === 'installmentsTotal') {
            rowValues[field] = installmentTotal
          } else {
            if (typeof person.offeringHistory !== 'undefined' && typeof person.offeringHistory[currentEvent.subEvent] !== 'undefined') {
              for (const [installmentName, installmentEntry] of Object.entries(person.offeringHistory[currentEvent.subEvent].installments)) {
                if (installmentName === 'refunded') {
                  installmentRefunded += installmentEntry.offeringAmount
                } else {
                  installmentReceived += installmentEntry.offeringAmount
                }
              }
            }
            if (field === 'installmentsReceived') {
              rowValues[field] = installmentReceived
            } else if (field === 'installmentsDue') {
              rowValues[field] = installmentTotal - installmentReceived
            } else {
              rowValues[field] = installmentRefunded
            }
          }
        }
      } else if (field === 'installmentsLF') {
        rowValues[field] = el.programs[currentEvent.aid].limitFee
      } else {
        console.log("UNKNOWN COLUMN NAME:", field)
        rowValues[field] = 'unknown'
      }
    }

    return rowValues;
  }

  const getOfferingHistory = (el) => {

    // reject test identities
    if (el.id.includes('test')) {
      return null;
    }

    // reject the unsubscribed
    if (el.unsubscribe) {
      return null;
    }

    // reject unjoined eligible people
    if (typeof el.programs[currentEvent.aid] === 'undefined' || typeof el.programs[currentEvent.aid].join === 'undefined') {
      return null;
    }
    if (!el.programs[currentEvent.aid].join) {
      return null;
    }

    var offeringHistory
    if (typeof el.programs[currentEvent.aid].offeringHistory !== 'undefined') {
      offeringHistory = el.programs[currentEvent.aid].offeringHistory
      for (const key of Object.keys(offeringHistory)) {
        //offeringHistory[key].offeringAmount = getGen3Amount(el.id, event.aid, value.offeringSKU)
        offeringHistory[key].offeringAmount = 123
      }
    }

    return offeringHistory

  }

  const counter = (list) => {
    return list.reduce(
      (prev, curr) => ({
        ...prev,
        [curr]: 1 + (prev[curr] || 0),
      }),
      {}
    );
  };

  const currencyFormat = (num) => {
    return '$' + num.toFixed(0).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
  }

  const headerHeightSetter = () => {
    var padding = 20;
    var height = headerHeightGetter() + padding;
    gridAPI.setHeaderHeight(height);
    gridAPI.resetRowHeights();
  }

  const onCellValueChanged = (e) => {
    if (group === "Read Only" || group === "Primary") {
      return
    }

    console.log("onCellValueChanged:", e.colDef.field, e.value)
    //console.log('onCellValueChanged checking: ' + '"' + eligibleParticipants[objIndex].programs[currentEvent.aid].notes + '" "' + data.notes + '"');
    if (e.colDef.field === 'notes') {
      console.log("onCellValueChanged NOTES for real => ", e.data.notes);
      waitForAIDFieldWrite(e.data.id, 'notes', e.value)
    }
  }

  const onCellClicked = (e) => {

    if (e.colDef.field === 'name') {
      if (typeof e.data.history !== 'undefined') {
        console.log("NAVIGATING TO => ", e.data.history);
        window.open(e.data.history);
        return
      }
    }

    if (e.colDef.field === 'email') {
      navigator.clipboard.writeText(e.data.email)
      toast.info("Copied " + e.data.email + " to the clipboard", { autoClose: 3000 })
      setValue(value + 1)
    }

    if (group === "Read Only" || group === "Primary") {
      return
    }
    console.log("onCellClicked:", e)
    if (e.colDef.field === 'owyaa') {
      handleOWYAA(e.data.id, e.data.name)
    } else if (e.colDef.field === 'transaction') {
      handleTransactionCopy(e.data.transaction)
    }
  }

  const setupGridAPI = (e) => {
    gridAPI = e.api
  }

  const handleOWYAA = async (id, name) => {
    let objIndex = allParticipants.findIndex((obj => obj.id === id));
    if (typeof allParticipants[objIndex].owyaaLease === 'undefined') {
      let date = new Date();
      let leaseTimestamp = date.toISOString()
      allParticipants[objIndex].owyaaLease = leaseTimestamp
      await writeParticipantOWYAALease(id, leaseTimestamp)
      toast.info("OWYAA Enabled for " + name + " for 90 days", { autoClose: 3000 })
    } else {
      // remove it
      delete allParticipants[objIndex].owyaaLease
      await writeParticipantOWYAALease(id, "")
      toast.info("OWYAA DISABLED for " + name, { autoClose: 3000 })
    }
    const [cl, rd] = await assembleColumnLabelsAndRowData(view, month, year)
    setColumnLabels(cl)
    setRowData(rd)
    setValue(value + 1)
  }

  const handleTransactionCopy = async (transaction) => {
    navigator.clipboard.writeText(transaction)
    toast.info("Copied " + transaction + " to the clipboard", { autoClose: 3000 })
    setValue(value + 1)
  }

  const assembleColumnLabelsAndRowData = async (lview, lmonth, lyear) => {
    var columnLabels
    var viewConditions
    var rowValues = []

    // create the columns from the provided column descriptors
    // all tables get a hidden id and history column def
    columnLabels = []
    // lookup dashboardView column definitions and add them
    let eventSpecificCDList
    try {
      // Guard: lview must be defined
      if (!lview) {
        throw new Error("No view selected for column/row assembly.");
      }
      // if there is a dashboardViews map and this view exists within it
      // try to get it
      let viewName = (typeof currentEvent.config.dashboardViews !== 'undefined' && typeof currentEvent.config.dashboardViews[lview] !== 'undefined')
        ? currentEvent.config.dashboardViews[lview]
        : lview;
      if (!viewName) {
        throw new Error("No view name found for getView.");
      }
      eventSpecificCDList = await fetchView(viewName)
      columnMetaData = {}
      viewConditions = eventSpecificCDList.viewConditions
      for (let i = 0; i < eventSpecificCDList.columnDefs.length; i++) {
        let defName = eventSpecificCDList.columnDefs[i].name
        try {
          let obj
          // handle specials
          const specials = { 'bool': { cellRenderer: 'checkboxRenderer', sortable: true, width: 100 }, 'string': { sortable: true }, 'number': { sortable: true, width: 100 } }
          if (defName.includes('poolMember')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].pool = eventSpecificCDList.columnDefs[i].pool
          } else if (defName.includes('currentAIDBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('specifiedAIDBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].aid = eventSpecificCDList.columnDefs[i].aid
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('currentAIDMapBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].map = eventSpecificCDList.columnDefs[i].map
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('currentAIDMapList')) {
            obj = specials['string']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].map = eventSpecificCDList.columnDefs[i].map
          } else if (defName.includes('specifiedAIDMapBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].aid = eventSpecificCDList.columnDefs[i].aid
            columnMetaData[defName].map = eventSpecificCDList.columnDefs[i].map
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('currentAIDString')) {
            obj = specials['string']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].stringName = eventSpecificCDList.columnDefs[i].stringName
          } else if (defName.includes('specifiedAIDString')) {
            obj = specials['string']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].aid = eventSpecificCDList.columnDefs[i].aid
            columnMetaData[defName].stringName = eventSpecificCDList.columnDefs[i].stringName
          } else if (defName.includes('currentAIDNumber')) {
            obj = specials['number']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].numberName = eventSpecificCDList.columnDefs[i].numberName
          } else if (defName.includes('specifiedAIDNumber')) {
            obj = specials['number']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].aid = eventSpecificCDList.columnDefs[i].aid
            columnMetaData[defName].numberName = eventSpecificCDList.columnDefs[i].numberName
          } else if (defName.includes('baseBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('baseString')) {
            obj = specials['string']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].stringName = eventSpecificCDList.columnDefs[i].stringName
          } else if (defName.includes('practiceBool')) {
            obj = specials['bool']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].boolName = eventSpecificCDList.columnDefs[i].boolName
          } else if (defName.includes('offeringCount')) {
            obj = specials['number']
            obj.field = defName
            obj.headerName = eventSpecificCDList.columnDefs[i].headerName
            columnMetaData[defName] = {}
            columnMetaData[defName].aid = eventSpecificCDList.columnDefs[i].aid
          } else {
            // pre-defined
            if (typeof g_predefinedColumnDefinitions[defName] === 'undefined') {
              console.log("UNKNOWN column definition:", defName)
              obj = g_predefinedColumnDefinitions['name']
            } else {
              obj = g_predefinedColumnDefinitions[defName]
            }
          }
          // console.log("columnDef:", defName, obj)
          columnLabels.push(obj)
        } catch (err) {
          let obj = {}
          obj.field = defName + '-ERR'
          columnLabels.push(obj)
          console.log("Can't find columnDef", defName)
        }
      }
      columnLabels.push(g_predefinedColumnDefinitions['id'])
      columnLabels.push(g_predefinedColumnDefinitions['history'])
    } catch (err) {
      console.error("Error in assembleColumnLabelsAndRowData:", err);
      toast.error(`Failed to load view configuration: ${err.message || 'Unknown error'}`);
      // fetchView failed, depending on the current view, select a fallback default
      if (typeof g_columnLabels[lview] !== 'undefined') {
        columnLabels = g_columnLabels[lview]
        viewConditions = g_viewConditions[lview]
        console.log("fetchView failed, select from pre-defined column defs:", lview, g_columnLabels[lview])
      } else {
        columnLabels = g_columnLabels['default']
        viewConditions = g_viewConditions['default']
        console.log("fetchView failed, fallback to default:", lview)
      }
    }

    for (let i = 0; i < eligibleParticipants.length; i++) {
      let row = getRowValues(viewConditions, columnLabels, eligibleParticipants[i])
      if (row !== null) {
        rowValues.push(row)
      }
    }

    setItemCount(rowValues.length)

    return [columnLabels, rowValues]
  }

  const defaultColDef = {
    resizable: true,
    autoHeight: true,
    // forces all columns to appear - flex: 1
  };

  // Register CheckboxRenderer for AG Grid
  const frameworkComponents = {
    checkboxRenderer: CheckboxRenderer
  };

  var width
  if (isMobile) {
    width = 800
  } else {
    width = 1150
  }

  const gridOptions = {
    // [...]
    rowClassRules: {
      "row-totals": function (params) { return params.data.Month === "TOTALS"; }
    },
    onSortChanged: (e) => e.api.refreshCells()
  };

  if (errMsg) {

    return (
      <>
        <Container style={{ fontSize: 24 }}>
          <br></br>
          <b>ERROR: {errMsg}</b>
        </Container>
        <Footer />
      </>
    )
  }

  if (verifyEmail) {
    return (
      <>
        <Container className="mt-3">
          <br />
          <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'verifyEmailHeader', 'English', 'dashboard', { aid: currentEventAid }, dbgPrompt, dbgout)} />
          <br />
          <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'verifyEmailMessage', 'English', 'dashboard', verifyEmail, undefined, undefined, student, null, dbgPrompt, dbgout)} />
        </Container>
        <Footer />
      </>
    )
  }

  if (!loaded || currentEvent === null) {
    const progress = loadingProgress.total > 0
      ? Math.round((loadingProgress.current / loadingProgress.total) * 100)
      : 0;

    return (
      <>
        <br></br><br></br>
        <Container style={{ fontSize: 18, marginTop: '70px' }}>
          <b>{loadingProgress.message || 'Loading...'} </b>
          <Spinner size="sm" animation="border" role="status"> </Spinner>
          {loadingProgress.total > 0 && (
            <>
              <br />
              <div style={{ marginTop: '10px' }}>
                {loadingProgress.current} of {loadingProgress.total} ({progress}%)
              </div>
            </>
          )}
        </Container>
        <Footer />
      </>
    )
  }

  return (
    <>
      <PlainSearchHeader />
      <ToastContainer />
      <Container style={{ marginTop: '70px' }}>
        <div id="myGrid" className="ag-theme-alpine" style={{ width: width, height: 800 }} >
          <AgGridReact
            rowData={rowData}
            defaultColDef={defaultColDef}
            columnDefs={columnLabels}
            frameworkComponents={frameworkComponents}
            onCellValueChanged={onCellValueChanged}
            onCellClicked={onCellClicked}
            onGridReady={setupGridAPI}
            gridOptions={gridOptions}
          />
        </div>
      </Container>
      <br></br><br></br>
      <Footer />
    </>
  );

};

// Add Next.js page configuration
export const getServerSideProps = async (context) => {
  return {
    props: {
      // Add any props you want to pass to the page
    },
  };
};

// Disable static optimization for this page
export const getInitialProps = async () => {
  return {};
};

export default Home;