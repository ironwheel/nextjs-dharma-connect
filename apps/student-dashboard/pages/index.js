/**
 * @file pages/index.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Main page for the nextjs-dharma-connect/student-dashboard project, displaying events, videos, and other content
 * based on user eligibility and preferences. Handles user authentication status,
 * data fetching via /api/db and /api/auth, and dynamic content rendering.
 */
import React, { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from 'next/router';
import { createPortal } from 'react-dom';
import { Container, Row, Col, Form, Card, Button } from "react-bootstrap";
import ReactSrcDocIframe from 'react-srcdoc-iframe';
import { publicIpv4 } from 'public-ip';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import packageJson from '../package.json';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faPlus, faMinus, faTimes, faPlusCircle, faMinusCircle, faUser, faCheck, faXmark } from "@fortawesome/pro-solid-svg-icons";
import Pusher from 'pusher-js';

// Shared utilities and components using '@/' alias
import { getFingerprint } from '@/utils/fingerprint';
import { dbgOut as studentDbgOut, dbgPrompt as studentDbgPrompt, dbgout as studentDbgout } from '@/utils/debugUtils';
import {
  promptLookup as basePromptLookup,
  promptLookupHTML as basePromptLookupHTML,
  promptLookupAIDSpecific as basePromptLookupAIDSpecific,
  promptLookupDescription as basePromptLookupDescription,
  promptLookupHTMLWithArgs as basePromptLookupHTMLWithArgs,
  promptLookupHTMLWithArgsAIDSpecific as basePromptLookupHTMLWithArgsAIDSpecific
} from '@/utils/promptUtils';
import { TopNavBar, BottomNavBar } from '@/components/SharedLayout';
import { eligible } from '@dharma/shared';
import { CSRF_HEADER_NAME } from '@dharma/backend-core'; // Import CSRF header name

const VIDEO_INDENT = 16;
const PDF_JS_VERSION = packageJson.dependencies['pdfjs-dist'] || '3.11.174'; // Fallback version
const REGCOMPLETE_WEBHOOK_CHANNEL = 'regcomplete';

// Module-level variables (consider moving to state or context for better React patterns if complexity grows)
let masterPrompts = [];
let displayPrompts = [];
let allEvents = [];
let allPools = [];
let eventList = [];
let liturgyList = [];
let videoListsByYear = {};
let showcaseMasterList = [];
let mantraList = [];
let scheduleList = [];
let translationMasterList = [];
let languageTransPerms = {};
// export let event = { aid: 'dashboard' }; // Default aid, potentially updated by showcase - Using state instead
export let student = {}; // Holds fetched student data - Using state instead for some parts
let displayControl = { // Holds visibility state for collapsible sections
  'control': true, 'event': false, 'liturgy': false, 'video': false,
  'mantra': false, 'schedule': false,
};
// let displayVideoControl = {}; // Not used in provided code, but was a previous variable
let pusherInstance = null; // Pusher client instance

// Debugging helpers using student context
const dbgOut = () => studentDbgOut(student);
const dbgPrompt = () => studentDbgPrompt(student);
const dbgout = (...args) => studentDbgout(student, ...args);
const dbgLocalHost = () => student && student.debug && student.debug.localHost;

// Prompt Lookup Wrappers providing context
// These will use module-level `student` and `event` for now.
// For better reactivity, these could be methods of the Home component or accept student/event as args.
const getPromptText = (key, aid = event.aid, lang = student.writtenLangPref || 'English') => basePromptLookup(displayPrompts, key, lang, aid, dbgPrompt, dbgout);
const getPromptHTML = (key, aid = event.aid, lang = student.writtenLangPref || 'English', promptArgs = {}) => basePromptLookupHTML(displayPrompts, key, lang, aid, student, { ...event, ...promptArgs }, dbgPrompt, dbgout);
const getPromptDescriptionForElement = (el) => {
  if (!el || !el.parentEvent || !el.parentEvent.aid || !el.subEventName) return null;
  const fullKey = `descriptions-${el.parentEvent.aid}-${el.subEventName}`;
  const lang = student.writtenLangPref || 'English';
  if (typeof basePromptLookupDescription !== 'function') {
    console.error("basePromptLookupDescription is not available!");
    return null;
  }
  return basePromptLookupDescription(displayPrompts, fullKey, lang, el.parentEvent.aid, student, el.parentEvent, dbgPrompt, dbgout);
};
const getPromptHTMLWithArgsWrapper = (key, arg1, arg2, arg3, aid = event.aid, lang = student.writtenLangPref || 'English') => basePromptLookupHTMLWithArgs(displayPrompts, key, lang, aid, arg1, arg2, arg3, student, event, dbgPrompt, dbgout);
const getPromptAIDSpecificWrapper = (targetAid, aidAlias, key, lang = student.writtenLangPref || 'English') => basePromptLookupAIDSpecific(displayPrompts, key, lang, targetAid, aidAlias, dbgPrompt, dbgout);

// Define read-only DB actions that don't need CSRF token for GET-like ops via POST
const READ_ONLY_DB_ACTIONS = [
  'findParticipant',
  'getPersonalMantra',
  'getGlobalMantra',
  'getEvents',
  'getPools',
  'getPrompts',
  'getConfigPrompts'
];


/**
 * Main Home page component. Handles application state, data fetching, and rendering.
 * @function Home
 * @returns {React.Component} The rendered Home page.
 */
const Home = () => {
  // --- State Variables ---
  const [loaded, setLoaded] = useState(false);
  const [loadStatus, setLoadStatus] = useState("Loading...");
  const [name, setName] = useState("Unknown");
  const [displayPid, setDisplayPid] = useState("Unknown");
  const [email, setEMail] = useState("Unknown");
  const [kmStatus, setKMStatus] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [forceRenderValue, setForceRenderValue] = useState(0);
  const [initialLoadAttempted, setInitialLoadAttempted] = useState(false);
  const [csrfToken, setCsrfToken] = useState(null); // State for CSRF token
  const [currentEventAid, setCurrentEventAid] = useState('dashboard'); // State for event.aid

  const router = useRouter();
  const { pid, language: queryLanguage, showcase } = router.query;

  /**
   * Forces a component re-render by incrementing a state variable.
   * @function forceRender
   */
  const forceRender = useCallback(() => setForceRenderValue(v => v + 1), []);

  /**
   * Updates the `displayPrompts` array based on the latest `masterPrompts`.
   * @function updateDisplayPrompts
   */
  const updateDisplayPrompts = useCallback(() => {
    displayPrompts = [...masterPrompts];
  }, []); // Depends implicitly on masterPrompts

  /**
   * Updates all the media lists based on current data.
   * @function updateMediaList
   */
  const updateMediaList = useCallback(() => {
    dbgout("updateMediaList called");
    eventList = []; liturgyList = []; videoListsByYear = {};
    showcaseMasterList = []; translationMasterList = [];
    Object.keys(displayControl).forEach(key => {
      if (key.startsWith('video-year-') || key.endsWith('-showcase') || key.endsWith('-translations')) {
        displayControl[key] = false;
      }
    });
    displayControl['event'] = false; displayControl['liturgy'] = false;
    displayControl['mantra'] = false; displayControl['schedule'] = false;

    updateDisplayPrompts();

    if (!allEvents || !allPools || !student || Object.keys(student).length === 0 || !masterPrompts || masterPrompts.length === 0) {
      dbgout("updateMediaList: Missing critical data. Aborting list update.");
      return;
    }

    const currentLang = student.writtenLangPref || 'English';

    eventList.push({ key: 'control-events', eventname: 'controlTitleEvents', tag: 'control', control: 'event', date: '9999-01-01', bg: 'primary', indent: 0 });
    liturgyList.push({ key: 'control-liturgies', eventname: 'controlTitleLiturgies', tag: 'control', control: 'liturgy', date: '9999-01-01', bg: 'primary', indent: 0 });
    mantraList = [{ key: 'control-mantra', eventname: 'controlTitleMantraCounter', tag: 'control', control: 'mantra', date: '9999-01-01', bg: 'primary', indent: 0 }];
    scheduleList = [{ key: 'control-schedule', eventname: 'controlTitleSchedule', tag: 'control', control: 'schedule', date: '9999-01-01', bg: 'primary', indent: 0 }];

    const descriptionsEvent = allEvents.find(e => e.aid === 'descriptions');
    let descriptionsMasterListIndex = -1;

    if (student.translator && descriptionsEvent?.config?.translationsOnDeck) {
      translationMasterList.push([]);
      descriptionsMasterListIndex = translationMasterList.length - 1;
      const descEventForControl = { name: "Event Descriptions", aid: 'descriptions' };
      translationMasterList[descriptionsMasterListIndex].push({
        key: 'translations-descriptions', displayOrder: 'AAAAAA_DESCRIPTIONS',
        eventname: 'translationsControlTitle-descriptions', tag: 'control',
        control: 'descriptions-translations', bg: "secondary", date: '9999-01-01',
        parentEvent: descEventForControl, complete: true
      });
      if (typeof displayControl['descriptions-translations'] === 'undefined') displayControl['descriptions-translations'] = false;
    }

    allEvents.forEach(pEvent => {
      if (!pEvent.subEvents || !eligible(pEvent.config.pool, student, pEvent.aid, allPools)) return;
      pEvent.coordEmail = (student.country === "United States") ? pEvent.config.coordEmailAmericas : pEvent.config.coordEmailEurope;

      if (student.translator && pEvent.config?.translationsOnDeck) {
        let currentTranslationListIndex = -1;
        if (pEvent.aid === 'descriptions' && descriptionsMasterListIndex !== -1) {
          currentTranslationListIndex = descriptionsMasterListIndex;
        } else if (pEvent.aid !== 'descriptions') {
          translationMasterList.push([]);
          currentTranslationListIndex = translationMasterList.length - 1;
          translationMasterList[currentTranslationListIndex].push({
            key: `translations-${pEvent.aid}`, displayOrder: `AAAAAA_${pEvent.aid.toUpperCase()}`,
            eventname: `translationsControlTitle-${pEvent.aid}`, tag: 'control',
            control: `${pEvent.aid}-translations`, bg: pEvent.config.translationsBG || "info",
            date: '9999-01-01', parentEvent: pEvent, complete: true
          });
          if (typeof displayControl[`${pEvent.aid}-translations`] === 'undefined') displayControl[`${pEvent.aid}-translations`] = false;
        }
        if (currentTranslationListIndex !== -1) {
          masterPrompts.forEach(promptObj => {
            if (promptObj.aid === pEvent.aid && promptObj.language === 'English' && !promptObj.dnt) {
              let langVersions = masterPrompts.filter(p => p.prompt === promptObj.prompt && p.language === currentLang);
              let currentLangPrompt = langVersions.length > 0 ? langVersions[0] : { ...promptObj, language: currentLang, text: "" };
              translationMasterList[currentTranslationListIndex].push({
                key: promptObj.prompt + '-' + currentLang, displayOrder: promptObj.prompt,
                tag: `${pEvent.aid}-translations`, eventname: promptObj.prompt,
                subEventDisplayName: null, subEventName: 'translation', date: '9998-01-01', complete: true,
                parentEvent: pEvent, subEvent: {},
                prompt: {
                  name: promptObj.prompt, english: promptObj.text, translation: currentLangPrompt.text,
                  restore: currentLangPrompt.text,
                  index: masterPrompts.findIndex(p => p.prompt === currentLangPrompt.prompt && p.language === currentLangPrompt.language),
                  lsb: currentLangPrompt.lsb
                }
              });
            }
          });
          translationMasterList[currentTranslationListIndex].sort((a, b) => {
            if (a.tag === 'control') return -1; if (b.tag === 'control') return 1;
            return a.displayOrder.localeCompare(b.displayOrder);
          });
        }
      }

      if (pEvent.showcaseVideoList) {
        showcaseMasterList.push([]);
        let showcaseIdx = showcaseMasterList.length - 1;
        const controlKey = `${pEvent.aid}-showcase`;
        showcaseMasterList[showcaseIdx].push({
          key: 'showcase_control_' + pEvent.aid, eventname: pEvent.showcaseControlTitle,
          tag: 'control', control: controlKey, date: '9999-01-01', parentEvent: pEvent, bg: 'success', indent: VIDEO_INDENT, complete: true
        });
        if (typeof displayControl[controlKey] === 'undefined') displayControl[controlKey] = false;
        pEvent.showcaseVideoList.forEach(showcaseElement => {
          const originalEvent = allEvents.find(ev => ev.aid === showcaseElement.aid);
          if (originalEvent?.subEvents?.[showcaseElement.subevent]) {
            const subEv = originalEvent.subEvents[showcaseElement.subevent];
            let title = getPromptAIDSpecificWrapper(originalEvent.aid, originalEvent.config.aidAlias, 'title');
            let subTitle = Object.keys(originalEvent.subEvents).length > 1 ? getPromptAIDSpecificWrapper(originalEvent.aid, originalEvent.config.aidAlias, showcaseElement.subevent) : null;
            showcaseMasterList[showcaseIdx].push({
              key: originalEvent.name + showcaseElement.subevent, tag: controlKey,
              eventname: title, subEventDisplayName: subTitle, subEventName: showcaseElement.subevent,
              date: subEv.date, complete: true, parentEvent: originalEvent, subEvent: subEv, indent: VIDEO_INDENT
            });
          }
        });
        if (showcaseMasterList[showcaseIdx].length > 1) {
          showcaseMasterList[showcaseIdx] = [showcaseMasterList[showcaseIdx][0], ...showcaseMasterList[showcaseIdx].slice(1).sort((a, b) => b.date.localeCompare(a.date))];
        }
        return;
      }

      Object.entries(pEvent.subEvents).forEach(([subEventName, subEventData]) => {
        if (typeof subEventData.eventOnDeck === 'undefined' || !subEventData.eventOnDeck) return;
        let title = getPromptAIDSpecificWrapper(pEvent.aid, pEvent.config.aidAlias, 'title');
        let subTitle = Object.keys(pEvent.subEvents).length > 1 ? getPromptAIDSpecificWrapper(pEvent.aid, pEvent.config.aidAlias, subEventName) : null;
        const displayItem = {
          key: pEvent.name + subEventName, aid: pEvent.aid, eventname: title,
          subEventDisplayName: subTitle, subEventName: subEventName, date: subEventData.date,
          complete: subEventData.eventComplete, parentEvent: pEvent, subEvent: subEventData, indent: 0
        };
        if (subEventData.eventComplete) {
          if (subEventData.embeddedPDFList) { displayItem.tag = 'liturgy'; liturgyList.push(displayItem); }
          else {
            const year = subEventData.date.substring(0, 4);
            if (!videoListsByYear[year]) {
              videoListsByYear[year] = [];
              const yearControlKey = `video-year-${year}`;
              videoListsByYear[year].push({
                key: yearControlKey, eventname: `controlTitleVideos${year}`,
                tag: 'control-video', control: yearControlKey, date: `9998-12-${31 - parseInt(year.slice(-2)) || 0}`,
                complete: true, bg: 'success', indent: VIDEO_INDENT, parentEvent: { aid: 'video-controls' }
              });
              if (typeof displayControl[yearControlKey] === 'undefined') displayControl[yearControlKey] = false;
            }
            displayItem.tag = `video-year-${year}`; displayItem.indent = VIDEO_INDENT;
            videoListsByYear[year].push(displayItem);
          }
        } else { displayItem.tag = 'event'; eventList.push(displayItem); }
      });
    });

    const compareDates = (a, b) => (a.date && b.date) ? b.date.localeCompare(a.date) : 0;
    const sortListWithControl = (list) => list.sort((a, b) => (a.tag === 'control' ? -1 : (b.tag === 'control' ? 1 : compareDates(a, b))));
    sortListWithControl(eventList); sortListWithControl(liturgyList);
    for (const year in videoListsByYear) {
      videoListsByYear[year] = [videoListsByYear[year][0], ...videoListsByYear[year].slice(1).sort(compareDates)];
    }
    showcaseMasterList.forEach(list => sortListWithControl(list));
    dbgout("updateMediaList finished.");
  }, [student, masterPrompts, allEvents, allPools, updateDisplayPrompts]);

  useEffect(() => {
    if (!router.isReady) return;
    if (verifyEmail || (initialLoadAttempted && !pid)) {
      return;
    }

    setLoadStatus("Initializing...");
    // Use state for event.aid
    const newEventAid = showcase ? showcase : 'dashboard';
    setCurrentEventAid(newEventAid);
    event.aid = newEventAid; // Update module-level for prompt wrappers (consider refactoring these)


    const callDbApi = async (action, payload, immediateToken = null) => {
      const tokenToUse = immediateToken || csrfToken;
      console.log(`Calling DB API Action: ${action} with CSRF token from: ${immediateToken ? 'arg' : (csrfToken ? 'state' : 'none')}.`);
      const headers = { 'Content-Type': 'application/json' };
      if (tokenToUse && !READ_ONLY_DB_ACTIONS.includes(action)) {
        headers[CSRF_HEADER_NAME] = tokenToUse;
      } else if (!tokenToUse && !READ_ONLY_DB_ACTIONS.includes(action)) {
        console.warn(`CSRF token is missing for state-changing DB action: ${action}. Backend will likely reject.`);
      }
      const response = await fetch(`/api/db`, { method: 'POST', headers, body: JSON.stringify({ action, payload }) });
      if (!response.ok) { const errorText = await response.text().catch(() => response.statusText); console.error(`DB API Error (${action}): ${response.status} ${errorText}`); throw new Error(`API Error (${response.status}) for action ${action}: ${errorText}`); }
      const result = await response.json(); if (result.data?.err) { console.error(`DB API Application Error (${action}): ${result.data.err}`); if (result.data.err === "PARTICIPANT_NOT_FOUND" || result.data.err === "MANTRA_RECORD_NOT_FOUND") { throw new Error(result.data.err); } throw new Error(`API returned error for action ${action}: ${result.data.err}`); }
      return result.data;
    };

    const fetchStudentData = (currentPid) => callDbApi('findParticipant', { id: currentPid });
    const fetchPools = () => callDbApi('getPools', {});
    const fetchEvents = () => callDbApi('getEvents', {});
    const fetchPrompts = () => callDbApi('getPrompts', { aid: newEventAid }); // Pass current event aid for prompts
    const writeStudentClickCount = (lpid, clickCount, clickTime, immediateCsrf = null) => callDbApi('writeDashboardClick', { id: lpid, clickCount, clickTime }, immediateCsrf);
    const writeProgramError = (lpid, errorKey, errorTimeKey, errorValue, immediateCsrf = null) => callDbApi('writeProgramError', { id: lpid, errorKey, errorTimeKey, errorValue }, immediateCsrf);

    const fetchLangTransPerms = async (currentPid) => {
      const response = await fetch(`/api/auth/?op=getPermissions&pid=${currentPid}`);
      if (!response.ok) { const errorData = await response.json().catch(() => ({})); const errorMsg = (response.status === 404 || errorData.data?.err?.includes('Permissions not found')) ? `Permissions not found for PID ${currentPid}` : `Failed to get lang trans perms (${response.status}): ${errorData.data?.err || response.statusText}`; throw new Error(errorMsg); }
      const result = await response.json(); if (result.data?.err) { throw new Error(`API error getting permissions: ${result.data.err}`); }
      return result.data || {};
    };
    const verifyAccess = async (currentPid, tokenToVerify) => {
      const response = await fetch("/api/auth/?op=verifyAccess", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: currentPid, ip: await publicIpv4().catch(() => null), fingerprint: await getFingerprint().catch(() => null), token: tokenToVerify }) });
      if (!response.ok) { const errorText = await response.text().catch(() => response.statusText); throw new Error(`Verify Access API Error: ${response.status} ${errorText}`); }
      const textBody = await response.text(); try { return JSON.parse(textBody); } catch (e) { console.warn("verifyAccess: API returned non-JSON response even with OK status:", textBody); throw new Error("INVALID_API_RESPONSE_FORMAT"); }
    };
    const sendConfirmationEmail = async (currentPid, currentShowcase) => {
      const response = await fetch("/api/auth/?op=confirm", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: currentPid, ip: await publicIpv4().catch(() => null), fingerprint: await getFingerprint().catch(() => null), showcase: currentShowcase }) });
      if (!response.ok) { const errData = await response.json().catch(() => ({ data: { err: `HTTP ${response.status}` } })); throw new Error(`Failed to send confirmation email: ${errData.data.err}`); }
      return response.json();
    };
    const writeStudentAccessVerifyError = (lpid, errorMsg, immediateCsrf = null) => writeProgramError(lpid, 'accessVerifyError', 'accessVerifyErrorTime', errorMsg, immediateCsrf);
    const writeStudentConfirmError = (lpid, errorMsg, immediateCsrf = null) => writeProgramError(lpid, 'confirmError', 'confirmErrorTime', errorMsg, immediateCsrf);

    const ensureCsrfToken = async () => {
      if (!csrfToken && localStorage.getItem('token')) {
        console.log("Attempting to fetch initial CSRF token via /api/auth?op=getCsrfToken...");
        try {
          const response = await fetch('/api/auth?op=getCsrfToken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Failed to get CSRF token (${response.status}): ${errData.data?.err || response.statusText}`);
          }
          const result = await response.json();
          if (result.data?.csrfToken) {
            console.log("Initial CSRF token fetched and set to state.");
            setCsrfToken(result.data.csrfToken);
            return result.data.csrfToken;
          } else {
            throw new Error("CSRF token not found in response from getCsrfToken.");
          }
        } catch (error) {
          console.error("Error fetching initial CSRF token:", error);
          setLoadStatus(`Error initializing secure session: ${error.message}. Try refreshing.`);
          return null;
        }
      }
      return csrfToken;
    };

    async function loadInitialData() {
      setInitialLoadAttempted(true);
      let currentCsrf = csrfToken;
      try {
        if (!pid) throw new Error("No PID provided in URL.");
        let token = localStorage.getItem('token');
        setLoadStatus("Loading configuration...");
        masterPrompts = await fetchPrompts() || [];
        updateDisplayPrompts();

        if (!token) {
          setLoadStatus("Requesting email verification...");
          await writeStudentAccessVerifyError(pid, "MISSING_TOKEN", currentCsrf).catch(e => console.error("Failed to log MISSING_TOKEN error:", e));
          if (queryLanguage) student.writtenLangPref = queryLanguage; // Update module-level student
          const confirmResp = await sendConfirmationEmail(pid, showcase);
          setVerifyEmail(confirmResp.data || 'unknown email');
          setLoadStatus(getPromptText('verifyEmailMessage', newEventAid, student.writtenLangPref).replace("||arg1||", confirmResp.data || 'your email'));
          setLoaded(true); return;
        }

        setLoadStatus("Verifying access...");
        const verifyResponse = await verifyAccess(pid, token);
        console.log("verifyAccess response:", verifyResponse);

        if (verifyResponse?.data?.err === 'INVALID_SESSION_TOKEN') {
          console.warn(`Invalid session token detected: ${verifyResponse.data.reason}. Requesting re-confirmation.`);
          currentCsrf = null; setCsrfToken(null);
          await writeStudentAccessVerifyError(pid, `INVALID_SESSION_TOKEN: ${verifyResponse.data.reason}`, currentCsrf).catch(e => console.error("Failed to log INVALID_SESSION_TOKEN error:", e));
          localStorage.removeItem('token');
          setLoadStatus("Requesting new email verification...");
          if (queryLanguage) student.writtenLangPref = queryLanguage;
          const confirmResp = await sendConfirmationEmail(pid, showcase);
          if (confirmResp.data?.err) {
            await writeStudentConfirmError(pid, confirmResp.data.err, currentCsrf).catch(e => console.error("Failed to log confirmation email error:", e));
            throw new Error(`Confirmation email error: ${confirmResp.data.err}`);
          }
          setVerifyEmail(confirmResp.data || 'unknown email');
          setLoadStatus(getPromptText('verifyEmailMessage', newEventAid, student.writtenLangPref).replace("||arg1||", confirmResp.data || 'your email'));
          setLoaded(true); return;
        }

        if (!verifyResponse || typeof verifyResponse.data === 'undefined' || verifyResponse.data.err) {
          console.error("Verification check returned unexpected structure or error:", verifyResponse);
          throw new Error(verifyResponse?.data?.err || "Verification check failed due to unexpected API response.");
        }

        console.log("Access token verified successfully.");
        currentCsrf = await ensureCsrfToken();

        setLoadStatus("Fetching user data...");
        const studentData = await fetchStudentData(pid);
        if (!studentData) throw new Error("Failed to fetch student data after verification.");
        student = studentData; // Update module-level student

        if (queryLanguage && !student.writtenLangPref) student.writtenLangPref = queryLanguage;
        if (!student.emailPreferences) student.emailPreferences = { videoNotify: true, offering: true, localPractice: false };
        updateDisplayPrompts(); // Re-run with potentially new student lang pref

        if (student.translator) {
          setLoadStatus("Fetching translator permissions...");
          languageTransPerms = await fetchLangTransPerms(pid);
        }

        setLoadStatus("Fetching content data...");
        const [poolsResult, eventsResult] = await Promise.all([fetchPools(), fetchEvents()]);
        allPools = poolsResult || [];
        allEvents = eventsResult || [];

        if (!student.programs) student.programs = {};
        if (!student.programs[newEventAid]) student.programs[newEventAid] = {}; // Use newEventAid
        const clickCount = (student.programs[newEventAid]?.clickCount || 0) + 1;
        const clickTime = new Date().toISOString();
        student.programs[newEventAid].clickCount = clickCount;
        student.programs[newEventAid].clickTime = clickTime;
        writeStudentClickCount(pid, clickCount, clickTime, currentCsrf).catch(err => console.error("Failed to write click count:", err));

        setName(`${student.first} ${student.last}`);
        setDisplayPid(pid);
        setEMail(student.email);
        setKMStatus(typeof student.kmCache !== 'undefined');
        updateMediaList();
        setLoadStatus("Connecting to real-time updates...");
        if (!pusherInstance) pusherInstance = new Pusher("0ecad01bb9fe0977da61", { cluster: 'mt1' });
        setLoaded(true);

      } catch (error) {
        console.error("Initialization Error in loadInitialData:", error);
        setLoadStatus(`Error: ${error?.message || 'Unknown error'}. Please try refreshing.`);
        setLoaded(true);
      }
    }

    if (!initialLoadAttempted && pid) {
      loadInitialData();
    }

    let channel = null;
    let isSubscribed = false;
    if (pid && pusherInstance && loaded && !verifyEmail && !isSubscribed) {
      console.log(`Pusher: Attempting to subscribe to ${REGCOMPLETE_WEBHOOK_CHANNEL} for PID ${pid}`);
      try {
        channel = pusherInstance.subscribe(REGCOMPLETE_WEBHOOK_CHANNEL);
        isSubscribed = true;
        const eventHandler = (data) => {
          console.log("PUSHER Webhook received:", data);
          setLoaded(false);
          setInitialLoadAttempted(false);
          setLoadStatus("Updating data from real-time event...");
          forceRender();
        };
        channel.bind(pid, eventHandler);
        return () => {
          if (channel && isSubscribed) {
            console.log(`Pusher: Unbinding PID ${pid} from ${REGCOMPLETE_WEBHOOK_CHANNEL}`);
            channel.unbind(pid, eventHandler);
            isSubscribed = false;
          }
        };
      } catch (pusherError) { console.error("Pusher subscription error:", pusherError); }
    }
  }, [router.isReady, pid, queryLanguage, showcase, loaded, verifyEmail, initialLoadAttempted, updateMediaList, forceRender, updateDisplayPrompts, csrfToken]); // Removed memoized API helpers from deps


  const KMStatus = () => {
    if (!kmStatus) return <div dangerouslySetInnerHTML={getPromptHTML('rcpNoAccount', currentEventAid)} />;
    return <>{getPromptText('rcpAccountFound', currentEventAid)}</>;
  };

  const DisplayEmailIFrame = ({ el, state }) => {
    const [iFrameData, setIFrameData] = useState("<p>Loading email content...</p>");
    const [englishOnlyNote, setEnglishOnlyNote] = useState(null);
    const currentLang = student.writtenLangPref || 'English';
    useEffect(() => {
      if (!el || !el.subEvent || !el.subEvent.embeddedEmails || !el.subEvent.embeddedEmails[state]) {
        setIFrameData("<p>Email content not available for this state.</p>"); return;
      }
      let pageLink = el.subEvent.embeddedEmails[state][currentLang] || el.subEvent.embeddedEmails[state]['English'];
      if (!pageLink) { setIFrameData(`<p>Email content not found for language: ${currentLang}.</p>`); return; }
      if (pageLink === el.subEvent.embeddedEmails[state]['English'] && currentLang !== 'English') {
        setEnglishOnlyNote(getPromptText('emailLanguageNotAvailable', currentEventAid));
      } else { setEnglishOnlyNote(null); }
      fetch(pageLink)
        .then(response => response.text())
        .then(pageData => {
          let processedData = pageData
            .replace(/\|\|name\|\|/g, `${student.first || ''} ${student.last || ''}`)
            .replace(/\|\|coord-email\|\|/g, el.parentEvent?.coordEmail || 'support@example.com')
            .replace(/123456789/g, pid || 'UNKNOWN_PID');
          if (dbgLocalHost()) processedData = processedData.replace(/https:\/\/reg\.slsupport\.link\//g, "http://localhost:3000/");
          const aidRegex = /&aid=([^"&]+)/;
          processedData = processedData.replace(aidRegex, (match) => `${match}&callback=${REGCOMPLETE_WEBHOOK_CHANNEL}`);
          setIFrameData(processedData);
        })
        .catch(err => { setIFrameData(`<p>Error loading email: ${err.message}</p>`); });
    }, [el, state, currentLang, pid]);
    return (<> {englishOnlyNote && <p><small>{englishOnlyNote}</small></p>} <ReactSrcDocIframe srcDoc={iFrameData} width="100%" height="360" frameBorder="0" /> </>);
  };

  const MediaElement = ({ el }) => {
    let offeringComplete = false;
    if (el.parentEvent.config.eligibleOnlyMediaAccess) {
      offeringComplete = true;
    } else if (student.programs?.[el.parentEvent.aid]?.offeringHistory) {
      if (el.parentEvent.config.offeringPresentation !== 'installments') {
        if (student.programs[el.parentEvent.aid].offeringHistory[el.subEventName]) offeringComplete = true;
      } else {
        if (student.programs[el.parentEvent.aid].offeringHistory.retreat?.offeringSKU) offeringComplete = true;
      }
    }
    const regLink = `${dbgLocalHost() ? 'http://localhost:3000' : 'https://reg.slsupport.link'}/?pid=${pid}&aid=${el.parentEvent.aid}&callback=${REGCOMPLETE_WEBHOOK_CHANNEL}`;

    if (!el.complete) {
      const hasOffering = student.programs?.[el.parentEvent.aid]?.offeringHistory?.[el.subEventName];
      const needsAcceptance = el.parentEvent.config.needAcceptance;
      const isAccepted = student.programs?.[el.parentEvent.aid]?.accepted;
      const hasApplied = student.programs?.[el.parentEvent.aid]?.join;

      if (el.parentEvent.config.offeringPresentation !== 'installments' && hasOffering) {
        return (<> {el.subEvent.timeString && <div dangerouslySetInnerHTML={{ __html: el.subEvent.timeString }} />} <div dangerouslySetInnerHTML={getPromptHTML('eventRegistered', el.parentEvent.aid)} /> {!el.parentEvent.config.inPerson && el.subEvent.zoomLink && <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('zoomLink', el.subEvent.zoomLink, el.subEvent.zoomLink, undefined, el.parentEvent.aid)} />} {!el.parentEvent.config.inPerson && !el.subEvent.zoomLink && <p>{getPromptText('zoomLinkNotAvailable', el.parentEvent.aid)}</p>} <DisplayEmailIFrame el={el} state={el.subEvent.embeddedEmails?.['reg-confirm'] ? 'reg-confirm' : 'accept'} /> </>);
      } else if (el.parentEvent.config.offeringPeriodClosed) {
        return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('offeringPeriodClosed', el.parentEvent.coordEmail, undefined, undefined, el.parentEvent.aid)} />;
      } else if (needsAcceptance) {
        if (isAccepted) return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('acceptedNotOffered', regLink, undefined, undefined, el.parentEvent.aid)} />;
        else if (hasApplied) return <div dangerouslySetInnerHTML={getPromptHTML('notAccepted', el.parentEvent.aid)} />;
        else if (el.parentEvent.config.applicationPeriodClosed) return <div dangerouslySetInnerHTML={getPromptHTML('applicationPeriodClosed', el.parentEvent.aid)} />;
        else if (el.subEvent.regLinkAvailable) return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('notApplied', regLink, undefined, undefined, el.parentEvent.aid)} />;
        else return <div dangerouslySetInnerHTML={getPromptHTML('registrationNotOpen', el.parentEvent.aid)} />;
      } else {
        if (el.subEvent.noRegRequired) return <DisplayEmailIFrame el={el} state={el.subEvent.embeddedEmails?.['reg-confirm'] ? 'reg-confirm' : 'reg'} />;
        else if (el.subEvent.regLinkAvailable) return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('eventRegister', regLink, undefined, undefined, el.parentEvent.aid)} />;
        else return <div dangerouslySetInnerHTML={getPromptHTML('registrationNotOpen', el.parentEvent.aid)} />;
      }
    } else {
      if (!el.subEvent.embeddedVideoList && !el.subEvent.embeddedPDFList && !el.subEvent.mediaLink) return <>{getPromptText('mediaNotAvailable', el.parentEvent.aid)}</>;
      if (!offeringComplete && el.parentEvent.config.mediaAttendeesOnly) return <div dangerouslySetInnerHTML={getPromptHTML('mediaAttendeesOnly', el.parentEvent.aid)} />;
      if (!offeringComplete && (el.subEvent.embeddedPDFList || el.subEvent.embeddedVideoList)) return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('mediaOffering', regLink, undefined, undefined, el.parentEvent.aid)} />;

      if (el.subEvent.embeddedPDFList) { return (<>{el.subEvent.embeddedPDFList.map((pdfEntry, index) => { const lang = student.writtenLangPref || 'English'; const pdfUrl = pdfEntry[lang] || pdfEntry['English']; if (!pdfUrl) return <p key={index}>PDF not available in {lang}.</p>; return (<div key={index} style={{ height: '750px', marginBottom: '20px', border: '1px solid #ccc' }}> <Worker workerUrl={`https://unpkg.com/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.worker.js`}> <Viewer fileUrl={pdfUrl} plugins={[defaultLayoutPlugin()]} /> </Worker> </div>); })}</>); }
      if (el.subEvent.embeddedVideoList) { return (<>{el.subEvent.embeddedVideoList.map((videoEntry, idx) => { const lang = student.writtenLangPref || 'English'; const vimeoId = videoEntry[lang] || videoEntry['English']; const password = videoEntry.password || el.subEvent.embeddedVideoListPassword; if (!vimeoId) return <p key={idx}>Video not available in {lang}</p>; const videoFrame = `<iframe src="https://player.vimeo.com/video/${vimeoId}?h=431770e871&amp;badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=181544" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" title="Video Player"></iframe>`; return (<div key={idx} style={{ marginBottom: '20px' }}> {videoEntry.title && <h4>{getPromptAIDSpecificWrapper(el.parentEvent.aid, el.parentEvent.config.aidAlias, videoEntry.title)}</h4>} {password && <p><small>Password: {password}</small></p>} <div dangerouslySetInnerHTML={{ __html: videoFrame }} /> </div>); })}</>); }
      if (el.subEvent.mediaLink) return <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('mediaAccess', el.subEvent.mediaLink, undefined, undefined, el.parentEvent.aid)} />;
      return <>{getPromptText('mediaNotAvailable', el.parentEvent.aid)}</>;
    }
  };

  const MediaElementWrapper = ({ el }) => {
    if (!el || !el.key) return null;
    if (el.tag === 'control' || el.tag === 'control-video') {
      const onControlClick = () => { if (el.control) { displayControl[el.control] = !displayControl[el.control]; forceRender(); } };
      const isExpanded = el.control ? !!displayControl[el.control] : false;
      const icon = isExpanded ? faMinus : faPlus;
      const title = getPromptText(el.eventname, el.parentEvent?.aid || currentEventAid) || 'Control Section';
      if (el.tag === 'control-video' && !displayControl['video']) return null;
      return (<Fragment key={el.key}> <Card border="dark" text={'white'} bg={el.bg || 'secondary'} onClick={onControlClick} style={{ cursor: "pointer", marginLeft: `${el.indent || 0}px` }} className="mb-3"> <Card.Body><Card.Title><FontAwesomeIcon size="lg" icon={icon} /> {title}</Card.Title></Card.Body> </Card> </Fragment>);
    }
    let parentControlKey = el.tag; let mainCategoryControlKey = el.tag?.startsWith('video-year-') ? 'video' : parentControlKey;
    if (!displayControl[parentControlKey] || (mainCategoryControlKey !== parentControlKey && !displayControl[mainCategoryControlKey])) return null;
    if (el.subEventName === 'translation' && el.prompt) {
      return (<Fragment key={el.key}> <Card border="secondary" text={'white'} bg={'dark'} style={{ marginLeft: `${el.indent || 0}px` }} className="mb-3"> <Card.Body> <Card.Title>Translate: {el.eventname} ({student.writtenLangPref || 'English'})</Card.Title> <p><strong>English:</strong> {el.prompt.english}</p> <Form.Control as="textarea" defaultValue={el.prompt.translation} rows={3} disabled={!languageTransPerms[student.writtenLangPref || 'English']} /> </Card.Body> </Card> </Fragment>);
    }
    const cardTitle = `${el.date ? el.date + ' ' : ''}${el.eventname}${el.subEventDisplayName ? ` (${el.subEventDisplayName})` : ''}`;
    const descriptionHTML = getPromptDescriptionForElement(el);
    return (
      <Fragment key={el.key}>
        <Card border="secondary" text={'white'} bg={'dark'} style={{ marginLeft: `${el.indent || 0}px` }} className="mb-3">
          <Card.Body> <Card.Title>{cardTitle}</Card.Title> <MediaElement el={el} /> </Card.Body>
          {descriptionHTML && <Card.Text className="p-3"><div dangerouslySetInnerHTML={descriptionHTML} /></Card.Text>}
          <Card.Footer> <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('emailForEvent', el.parentEvent.coordEmail, el.parentEvent.coordEmail, undefined, el.parentEvent.aid)} /> </Card.Footer>
        </Card>
      </Fragment>
    );
  };

  const MediaList = () => {
    const sortedVideoYears = Object.keys(videoListsByYear).sort((a, b) => b.localeCompare(a));
    const mainVideoControl = Object.keys(videoListsByYear).length > 0 ? <MediaElementWrapper key="videos_main_control" el={{ key: 'videos_main_control', eventname: 'controlTitleVideos', tag: 'control', control: 'video', bg: 'success', indent: 0, parentEvent: { aid: 'dashboard' } }} /> : null;
    return (
      <>
        {eventList.map((el) => <MediaElementWrapper key={el.key} el={el} />)}
        {liturgyList.length > 0 ? liturgyList.map((el) => <MediaElementWrapper key={el.key} el={el} />) : null}
        {mainVideoControl}
        {displayControl['video'] && sortedVideoYears.map(year => videoListsByYear[year].map(el => <MediaElementWrapper key={el.key} el={el} />))}
        {showcaseMasterList.map(list => list.map(el => <MediaElementWrapper key={el.key} el={el} />))}
        {scheduleList.map(el => <MediaElementWrapper key={el.key} el={el} />)}
        {displayControl['schedule'] && <Schedule />}
        {mantraList.map(el => <MediaElementWrapper key={el.key} el={el} />)}
        {displayControl['mantra'] && <MantraCount />}
        {translationMasterList.map(list => list.map(el => <MediaElementWrapper key={el.key} el={el} />))}
      </>
    );
  };

  const Schedule = () => {
    if (!displayControl['schedule']) return null;
    return <div dangerouslySetInnerHTML={getPromptHTML('schedule', currentEventAid)} />;
  };

  const MantraCount = () => {
    if (!displayControl['mantra'] || typeof student.mid === 'undefined') return null;
    const [countsLoaded, setCountsLoaded] = useState(false);
    const [countsLoadStatus, setCountsLoadStatus] = useState("Loading counts...");
    const [personalCounts, setPersonalCounts] = useState({});
    const [initialPersonalCounts, setInitialPersonalCounts] = useState({});
    const [globalCounts, setGlobalCounts] = useState({});
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
      if (!student.mid) return;
      let isMounted = true;
      const fetchCounts = async () => {
        try {
          setCountsLoadStatus("Loading counts...");
          const [personalData, globalData] = await Promise.all([
            callDbApi('getPersonalMantra', { id: student.mid }),
            callDbApi('getGlobalMantra', {})
          ]);
          if (isMounted) {
            setPersonalCounts(personalData || {});
            setInitialPersonalCounts(personalData || {});
            setGlobalCounts(globalData || {});
            setCountsLoaded(true);
          }
        } catch (error) {
          console.error("Mantra counts fetch error:", error);
          if (isMounted) setCountsLoadStatus(`Error loading counts: ${error.message}`);
        }
      };
      fetchCounts();
      return () => { isMounted = false; };
    }, [student.mid]);

    const numberWithCommas = (x = 0) => (x || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const bumpCount = (field, increment) => {
      setErrorMsg('');
      const currentVal = personalCounts[field] || 0;
      const initialVal = initialPersonalCounts[field] || 0;
      if (increment < 0 && (currentVal + increment < initialVal)) { setErrorMsg("Cannot decrement below saved value."); return; }
      setPersonalCounts(prev => ({ ...prev, [field]: (prev[field] || 0) + increment }));
      setGlobalCounts(prev => ({ ...prev, [`g${field}`]: (prev[`g${field}`] || 0) + increment }));
    };
    const handleCommit = async () => {
      setErrorMsg('');
      try {
        await callDbApi('putPersonalMantra', { id: student.mid, ...personalCounts });
        setInitialPersonalCounts(personalCounts);
        displayControl['mantra'] = false;
        forceRender();
      } catch (error) { console.error("Failed to save mantra counts:", error); setErrorMsg(`Failed to save counts: ${error.message}. Please try again.`); }
    };
    const handleCancel = () => { displayControl['mantra'] = false; forceRender(); };

    if (!countsLoaded) return <p>{countsLoadStatus}</p>;
    const mantraSections = [
      { id: 'mcount', titleKey: 'mantraCountMBTitle', cardClass: 'card-white' },
      { id: 'c1count', titleText: 'Seven-Line Supplication to Padmakara', cardClass: 'card-white' },
      { id: 'c2count', titleText: 'Condensed Supplication To Tara', cardClass: 'card-white' },
      { id: 'c3count', titleText: 'Pacifying the Turmoil of the Mamos', cardClass: 'card-red' },
      { id: 'c4count', titleText: 'Condensed Dispelling of Obstacles', cardClass: 'card-red' },
    ];
    return (
      <div className="App">
        <div className="App-header" dangerouslySetInnerHTML={getPromptHTML('mantraCountIntro', currentEventAid)} />
        <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('mantraCountCommunity', globalCounts.pcount?.toString() || '0', globalCounts.distinctCountries?.join(", ") || '', undefined, currentEventAid)} />
        <br /> {errorMsg && <p style={{ color: 'red' }}>{errorMsg}</p>}
        <Container> <Row> {mantraSections.map(sec => (<Col key={sec.id} md className="mb-3"> <Card className={`${sec.cardClass} text-center`}> <Card.Header as="div" className="d-flex justify-content-between p-2"> <Button variant="link" className="p-0 text-decoration-none" onClick={() => bumpCount(sec.id, -100)} title="Subtract 100"> <FontAwesomeIcon icon={faMinusCircle} size="lg" /> </Button> <Button variant="link" className="p-0 text-decoration-none" onClick={() => bumpCount(sec.id, 100)} title="Add 100"> <FontAwesomeIcon icon={faPlusCircle} size="lg" /> </Button> </Card.Header> <Card.Body> <Card.Title style={{ minHeight: '3em' }}>{sec.titleKey ? getPromptText(sec.titleKey, currentEventAid) : sec.titleText}</Card.Title> <p><FontAwesomeIcon icon={faUser} /> {numberWithCommas(personalCounts[sec.id])}</p> <p><FontAwesomeIcon icon={faGlobe} /> {numberWithCommas(globalCounts[`g${sec.id}`])}</p> </Card.Body> </Card> </Col>))} </Row> </Container> <br />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}> <Button variant="secondary" onClick={handleCancel}><FontAwesomeIcon icon={faTimes} /> Cancel & Exit</Button> <Button variant="primary" onClick={handleCommit}><FontAwesomeIcon icon={faCheck} /> Save & Exit</Button> </div> <br />
      </div>
    );
  };

  const EMailPreferences = () => {
    const [prefs, setPrefs] = useState(student.emailPreferences || { videoNotify: true, offering: true, localPractice: false });
    const handleChange = async (e) => {
      const { name, checked } = e.target;
      const updatedPrefs = { ...prefs, [name]: checked };
      setPrefs(updatedPrefs);
      student.emailPreferences = updatedPrefs;
      try {
        await callDbApi('updateEmailPreferences', { id: pid, emailPreferences: updatedPrefs });
      } catch (error) { console.error("Failed to save email preferences:", error); }
    };
    return (<> <div dangerouslySetInnerHTML={getPromptHTML('emailPreferences', currentEventAid)} /> <Form.Group as={Row} controlId="EMailPreferencesForm"> <Col sm={10}> <Form.Check inline onChange={handleChange} checked={!!prefs.videoNotify} name="videoNotify" label={getPromptText("emailPreferencesVideoNotify", currentEventAid)} type="checkbox" id="checkbox-VN" /> <Form.Check inline onChange={handleChange} checked={!!prefs.offering} name="offering" label={getPromptText("emailPreferencesOffering", currentEventAid)} type="checkbox" id="checkbox-Offering" /> <Form.Check inline onChange={handleChange} checked={!!prefs.localPractice} name="localPractice" label={getPromptText("emailPreferencesLocalPractice", currentEventAid)} type="checkbox" id="checkbox-LP" /> </Col> </Form.Group> <br /> </>);
  };

  const MediaDashboard = () => (
    <> <br /> <p className="mb-1"><b>{name}</b></p> <p className="mb-2"><b>{email}</b></p> <KMStatus /><br /> <div dangerouslySetInnerHTML={getPromptHTML('msg0', currentEventAid)} /> <div dangerouslySetInnerHTML={getPromptHTML('msg1', currentEventAid)} /> <div dangerouslySetInnerHTML={getPromptHTML('msg2', currentEventAid)} /> <div dangerouslySetInnerHTML={getPromptHTML('msg3', currentEventAid)} /> <br /> <MediaList /> <EMailPreferences /> <br /> </>
  );

  if (!loaded && !verifyEmail) {
    return <Container className="mt-3"><p><b>{loadStatus}</b></p></Container>;
  }
  if (verifyEmail) {
    return (<Container className="mt-3"> <br /> <div dangerouslySetInnerHTML={getPromptHTML('verifyEmailHeader', currentEventAid)} /> <br /> <div dangerouslySetInnerHTML={getPromptHTMLWithArgsWrapper('verifyEmailMessage', verifyEmail, undefined, undefined, currentEventAid)} /> </Container>);
  }
  return (
    <>
      <TopNavBar titlePromptKey="title" currentLanguage={student.writtenLangPref || 'English'} onLanguageChange={(langKey) => { student.writtenLangPref = langKey; updateDisplayPrompts(); updateMediaList(); forceRender(); }} getPromptText={(key) => getPromptText(key, currentEventAid)} />
      <Container> <MediaDashboard /> </Container>
      <BottomNavBar scrollMsg={loadStatus.startsWith("Error:") ? loadStatus : ""} getPromptText={(key) => getPromptText(key, currentEventAid)} />
      <div style={{ height: '60px' }} /> {/* Spacer */}
    </>
  );
};

export default Home;
