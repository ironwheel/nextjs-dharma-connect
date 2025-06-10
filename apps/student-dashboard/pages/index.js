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
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import packageJson from '../package.json';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faPlus, faMinus, faTimes, faPlusCircle, faMinusCircle, faUser, faCheck, faXmark } from "@fortawesome/pro-solid-svg-icons";
import Pusher from 'pusher-js';

// Shared utilities and components using '@/' alias
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
import {
  callDbApi,
  sendConfirmationEmail,
  verifyAccess,
  ensureCsrfToken,
  clearCsrfToken
} from '@dharma/shared';
import { CSRF_HEADER_NAME } from '@dharma/backend-core'; // Import CSRF header name

const VIDEO_INDENT = 16;
const PDF_JS_VERSION = packageJson.dependencies['pdfjs-dist'] || '3.11.174'; // Fallback version
const REGCOMPLETE_WEBHOOK_CHANNEL = 'regcomplete';

// Module-level variables
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

export let student = {};
let displayControl = {
  'control': true, 'event': false, 'liturgy': false, 'video': false,
  'mantra': false, 'schedule': false,
};
let pusherInstance = null;

const dbgOut = () => studentDbgOut(student);
const dbgPrompt = () => studentDbgPrompt(student);
const dbgout = (...args) => studentDbgout(student, ...args);
const dbgLocalHost = () => student && student.debug && student.debug.localHost;

const Home = () => {
  const router = useRouter();
  const { pid, language: queryLanguage, showcase } = router.query;

  const [loaded, setLoaded] = useState(false);
  const [loadStatus, setLoadStatus] = useState("Loading...");
  const [name, setName] = useState("Unknown");
  const [displayPid, setDisplayPid] = useState("Unknown");
  const [email, setEMail] = useState("Unknown");
  const [kmStatus, setKMStatus] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [forceRenderValue, setForceRenderValue] = useState(0);
  const [initialLoadAttempted, setInitialLoadAttempted] = useState(false);
  const [currentEventAid, setCurrentEventAid] = useState('dashboard');

  // Component-specific helper functions
      throw error;
    }
  };

  const forceRender = useCallback(() => setForceRenderValue(v => v + 1), []);
  const updateDisplayPrompts = useCallback(() => { displayPrompts = [...masterPrompts]; }, []);
  const fetchStudentData = (currentPid) => callDbApi('findParticipant', { id: currentPid });
  const fetchPools = () => callDbApi('getPools', {});
  const fetchEvents = () => callDbApi('getEvents', {});
  const fetchLangTransPerms = async (pid) => {
    try {
      const response = await fetch(`/api/auth?pid=${pid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getPermissions'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.data?.err || `Failed to fetch language permissions with status ${response.status}`);
      }

      const result = await response.json();
      return result?.data || {};
    } catch (error) {
      console.error('Error fetching language permissions:', error);
      return {};
    }
  };
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

  const writeStudentClickCount = async (pid, clickCount, clickTime) => {
    try {
      const token = await ensureCsrfToken();
      const response = await fetch('/api/db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { [CSRF_HEADER_NAME]: token })
        },
        body: JSON.stringify({
          action: 'writeDashboardClick',
          payload: {
            id: pid,
            clickCount,
            clickTime
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.data?.err === 'CSRF_TOKEN_MISSING' || errorData.data?.err === 'CSRF_TOKEN_MISMATCH') {
          clearCsrfToken();
          return writeStudentClickCount(pid, clickCount, clickTime);
        }
        throw new Error(errorData.data?.err || `Failed to write click count with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error writing click count:', error);
      throw error;
    }
  };

  const loadStudentData = async () => {
    try {
      console.log('Loading student data...');
      const result = await callDbApi('getStudent', { pid });
      console.log('Student data result:', result);
      if (!result || !result.student) {
        console.error('Invalid student data result:', result);
        return;
      }
      student = result.student;
      allEvents = result.events || [];
      allPools = result.pools || [];
      masterPrompts = await fetchPrompts(student.aid) || [];
      updateDisplayPrompts();
      setLoaded(true);
    } catch (error) {
      console.error('Error loading student data:', error);
    }
  };


  async function loadInitialData() {
    setInitialLoadAttempted(true);
    try {
      if (!pid) throw new Error("No PID provided in URL.");

      let token = localStorage.getItem('token');
      setCurrentEventAid(showcase ? showcase : 'dashboard');

      // First, try to get basic prompts without a session token
      setLoadStatus("Loading basic information...");
      try {
        masterPrompts = await fetchPrompts(currentEventAid);
        if (masterPrompts.length === 0) {
          console.warn("No prompts loaded, but continuing with initialization");
        }
        updateDisplayPrompts();
      } catch (error) {
        console.error("Error fetching prompts:", error);
        setLoadStatus("Warning: Could not load prompts, but continuing...");
      }

      // If no session token, request email verification
      if (!token) {
        setLoadStatus("Requesting email verification...");
        try {
          const confirmResp = await sendConfirmationEmail(pid, showcase || 'dashboard');
          if (confirmResp.data?.err) {
            throw new Error(`Confirmation email error: ${confirmResp.data.err}`);
          }
          setVerifyEmail(confirmResp.data || 'unknown email');
          setLoaded(true);
          return;
        } catch (error) {
          console.error("Error sending confirmation email:", error);
          setLoadStatus(`Error: ${error.message}. Please try refreshing.`);
          setLoaded(true);
          return;
        }
      }

      // If we have a token, proceed with full initialization
      setLoadStatus("Initializing secure session...");
      let initialCsrfToken = null;
      try {
        initialCsrfToken = await ensureCsrfToken();
      } catch (error) {
        console.error("Failed to initialize CSRF token:", error);
        throw error;
      }

      // Continue with the rest of the initialization...
      setLoadStatus("Verifying access...");
      const verifyResponse = await verifyAccess(pid, token);
      console.log("verifyAccess response:", verifyResponse);

      if (!studentData) throw new Error("Failed to fetch student data after verification.");
      student = studentData;

      student.writtenLangPref = queryLanguage || student.writtenLangPref;
      if (!student.emailPreferences) student.emailPreferences = { videoNotify: true, offering: true, localPractice: false };
      updateDisplayPrompts();

      if (student.translator) {
        setLoadStatus("Fetching translator permissions...");
        languageTransPerms = await fetchLangTransPerms(pid);
      }

      setLoadStatus("Fetching content data...");
      const [poolsResult, eventsResult] = await Promise.all([fetchPools(), fetchEvents()]);
      allPools = poolsResult || [];
      allEvents = eventsResult || [];

      if (!student.programs) student.programs = {};
      if (!student.programs[currentEventAid]) student.programs[currentEventAid] = {};
      const clickCount = (student.programs[currentEventAid]?.clickCount || 0) + 1;
      const clickTime = new Date().toISOString();
      student.programs[currentEventAid].clickCount = clickCount;
      student.programs[currentEventAid].clickTime = clickTime;
      await writeStudentClickCount(pid, clickCount, clickTime, initialCsrfToken).catch(err => console.error("Failed to write click count:", err));

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


  // Main initialization effect
  useEffect(() => {
    if (!router.isReady) return;
    if (verifyEmail || (initialLoadAttempted && !pid)) { return; }

    setLoadStatus("Initializing...");
    setCurrentEventAid(showcase ? showcase : 'dashboard');

    // Initialize CSRF token early
    ensureCsrfToken().then(token => {
      if (token) {
      } else {
        console.warn("Failed to initialize CSRF token");
      }
    }).catch(error => {
      console.error("Error initializing CSRF token:", error);
    });

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
  }, [router.isReady, pid, queryLanguage, showcase, loaded, verifyEmail, initialLoadAttempted]);

  // Component-specific helper functions
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
      dbgout("updateMediaList: Missing critical data."); return;
    }
    const currentLang = student.writtenLangPref || 'English';
    eventList.push({ key: 'control-events', eventname: 'controlTitleEvents', tag: 'control', control: 'event', date: '9999-01-01', bg: 'primary', indent: 0 });
    liturgyList.push({ key: 'control-liturgies', eventname: 'controlTitleLiturgies', tag: 'control', control: 'liturgy', date: '9999-01-01', bg: 'primary', indent: 0 });
    mantraList = [{ key: 'control-mantra', eventname: 'controlTitleMantraCounter', tag: 'control', control: 'mantra', date: '9999-01-01', bg: 'primary', indent: 0 }];
    scheduleList = [{ key: 'control-schedule', eventname: 'controlTitleSchedule', tag: 'control', control: 'schedule', date: '9999-01-01', bg: 'primary', indent: 0 }];
    const descriptionsEvent = allEvents.find(e => e.aid === 'descriptions');
      if (pEvent.showcaseVideoList) {
        showcaseMasterList.push([]); let showcaseIdx = showcaseMasterList.length - 1;
        const controlKey = `${pEvent.aid}-showcase`;
        showcaseMasterList[showcaseIdx].push({ key: 'showcase_control_' + pEvent.aid, eventname: pEvent.showcaseControlTitle, tag: 'control', control: controlKey, date: '9999-01-01', parentEvent: pEvent, bg: 'success', indent: VIDEO_INDENT, complete: true });
        if (typeof displayControl[controlKey] === 'undefined') displayControl[controlKey] = false;
        pEvent.showcaseVideoList.forEach(showcaseElement => {
          const originalEvent = allEvents.find(ev => ev.aid === showcaseElement.aid);
          if (originalEvent?.subEvents?.[showcaseElement.subevent]) {
            const subEv = originalEvent.subEvents[showcaseElement.subevent];
            let title = promptLookupAIDSpecific(displayPrompts, 'title', student?.writtenLangPref || 'English', originalEvent.aid, originalEvent.config.aidAlias, dbgPrompt, dbgout);
            let subTitle = Object.keys(originalEvent.subEvents).length > 1 ?
              promptLookupAIDSpecific(displayPrompts, showcaseElement.subevent, student?.writtenLangPref || 'English', originalEvent.aid, originalEvent.config.aidAlias, dbgPrompt, dbgout) :
              null;
            showcaseMasterList[showcaseIdx].push({ key: originalEvent.name + showcaseElement.subevent, tag: controlKey, eventname: title, subEventDisplayName: subTitle, subEventName: showcaseElement.subevent, date: subEv.date, complete: true, parentEvent: originalEvent, subEvent: subEv, indent: VIDEO_INDENT });
          }
        });
        if (showcaseMasterList[showcaseIdx].length > 1) { showcaseMasterList[showcaseIdx] = [showcaseMasterList[showcaseIdx][0], ...showcaseMasterList[showcaseIdx].slice(1).sort((a, b) => b.date.localeCompare(a.date))]; }
        return;
      }
      Object.entries(pEvent.subEvents).forEach(([subEventName, subEventData]) => {
        if (typeof subEventData.eventOnDeck === 'undefined' || !subEventData.eventOnDeck) return;
        let title = promptLookupAIDSpecific(displayPrompts, 'title', student?.writtenLangPref || 'English', pEvent.aid, pEvent.config.aidAlias, dbgPrompt, dbgout);
        let subTitle = Object.keys(pEvent.subEvents).length > 1 ?
          promptLookupAIDSpecific(displayPrompts, subEventName, student?.writtenLangPref || 'English', pEvent.aid, pEvent.config.aidAlias, dbgPrompt, dbgout) :
          null;
        const displayItem = { key: pEvent.name + subEventName, aid: pEvent.aid, eventname: title, subEventDisplayName: subTitle, subEventName: subEventName, date: subEventData.date, complete: subEventData.eventComplete, parentEvent: pEvent, subEvent: subEventData, indent: 0 };
        if (subEventData.eventComplete) {
          if (subEventData.embeddedPDFList) { displayItem.tag = 'liturgy'; liturgyList.push(displayItem); }
          else {
            const year = subEventData.date.substring(0, 4);
            if (!videoListsByYear[year]) {
              videoListsByYear[year] = []; const yearControlKey = `video-year-${year}`;
              videoListsByYear[year].push({ key: yearControlKey, eventname: `controlTitleVideos${year}`, tag: 'control-video', control: yearControlKey, date: `9998-12-${31 - parseInt(year.slice(-2)) || 0}`, complete: true, bg: 'success', indent: VIDEO_INDENT, parentEvent: { aid: 'video-controls' } });
              if (typeof displayControl[yearControlKey] === 'undefined') displayControl[yearControlKey] = false;
            }
            displayItem.tag = `video-year-${year}`; displayItem.indent = VIDEO_INDENT; videoListsByYear[year].push(displayItem);
          }
        } else { displayItem.tag = 'event'; eventList.push(displayItem); }
      });
    });
    const compareDates = (a, b) => (a.date && b.date) ? b.date.localeCompare(a.date) : 0;
    const sortListWithControl = (list) => list.sort((a, b) => (a.tag === 'control' ? -1 : (b.tag === 'control' ? 1 : compareDates(a, b))));
    sortListWithControl(eventList); sortListWithControl(liturgyList);
    for (const year in videoListsByYear) { videoListsByYear[year] = [videoListsByYear[year][0], ...videoListsByYear[year].slice(1).sort(compareDates)]; }
    showcaseMasterList.forEach(list => sortListWithControl(list));
    dbgout("updateMediaList finished.");
  }, [student, masterPrompts, allEvents, allPools, updateDisplayPrompts]);

  const KMStatus = () => {
    if (!kmStatus) return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'rcpNoAccount', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />;
    return <>{promptLookup(displayPrompts, 'rcpAccountFound', student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)}</>;
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
        setEnglishOnlyNote(promptLookup(displayPrompts, 'emailLanguageNotAvailable', student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout));
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
        return (<>
          {el.subEvent.timeString && <div dangerouslySetInnerHTML={{ __html: el.subEvent.timeString }} />}
          <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'eventRegistered', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />
          {!el.parentEvent.config.inPerson && el.subEvent.zoomLink &&
            <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'zoomLink', student?.writtenLangPref || 'English', el.parentEvent.aid, el.subEvent.zoomLink, el.subEvent.zoomLink, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />}
          {!el.parentEvent.config.inPerson && !el.subEvent.zoomLink &&
            <p>{promptLookup(displayPrompts, 'zoomLinkNotAvailable', student?.writtenLangPref || 'English', el.parentEvent.aid, dbgPrompt, dbgout)}</p>}
          <DisplayEmailIFrame el={el} state={el.subEvent.embeddedEmails?.['reg-confirm'] ? 'reg-confirm' : 'accept'} />
        </>);
      } else if (el.parentEvent.config.offeringPeriodClosed) {
        return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'offeringPeriodClosed', student?.writtenLangPref || 'English', el.parentEvent.aid, el.parentEvent.coordEmail, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
      } else if (needsAcceptance) {
        if (isAccepted)
          return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'acceptedNotOffered', student?.writtenLangPref || 'English', el.parentEvent.aid, regLink, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
        else if (hasApplied)
          return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'notAccepted', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
        else if (el.parentEvent.config.applicationPeriodClosed)
          return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'applicationPeriodClosed', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
        else if (el.subEvent.regLinkAvailable)
          return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'notApplied', student?.writtenLangPref || 'English', el.parentEvent.aid, regLink, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
        else
          return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'registrationNotOpen', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
      } else {
        if (el.subEvent.noRegRequired)
          return <DisplayEmailIFrame el={el} state={el.subEvent.embeddedEmails?.['reg-confirm'] ? 'reg-confirm' : 'reg'} />;
        else if (el.subEvent.regLinkAvailable)
          return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'eventRegister', student?.writtenLangPref || 'English', el.parentEvent.aid, regLink, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
        else
          return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'registrationNotOpen', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
      }
    } else {
      if (!el.subEvent.embeddedVideoList && !el.subEvent.embeddedPDFList && !el.subEvent.mediaLink)
        return <>{promptLookup(displayPrompts, 'mediaNotAvailable', student?.writtenLangPref || 'English', el.parentEvent.aid, dbgPrompt, dbgout)}</>;
      if (!offeringComplete && el.parentEvent.config.mediaAttendeesOnly)
        return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'mediaAttendeesOnly', student?.writtenLangPref || 'English', el.parentEvent.aid, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
      if (!offeringComplete && (el.subEvent.embeddedPDFList || el.subEvent.embeddedVideoList))
        return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'mediaOffering', student?.writtenLangPref || 'English', el.parentEvent.aid, regLink, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;

      if (el.subEvent.embeddedPDFList) {
        return (<>
          {el.subEvent.embeddedPDFList.map((pdfEntry, index) => {
            const lang = student.writtenLangPref || 'English';
            const pdfUrl = pdfEntry[lang] || pdfEntry['English'];
            if (!pdfUrl) return <p key={index}>PDF not available in {lang}.</p>;
            return (
              <div key={index} style={{ height: '750px', marginBottom: '20px', border: '1px solid #ccc' }}>
                <Worker workerUrl={`https://unpkg.com/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.worker.js`}>
                  <Viewer fileUrl={pdfUrl} plugins={[defaultLayoutPlugin()]} />
                </Worker>
              </div>
            );
          })}
        </>);
      }
      if (el.subEvent.embeddedVideoList) {
        return (<>
          {el.subEvent.embeddedVideoList.map((videoEntry, idx) => {
            const lang = student.writtenLangPref || 'English';
            const vimeoId = videoEntry[lang] || videoEntry['English'];
            const password = videoEntry.password || el.subEvent.embeddedVideoListPassword;
            if (!vimeoId) return <p key={idx}>Video not available in {lang}</p>;
            const videoFrame = `<iframe src="https://player.vimeo.com/video/${vimeoId}?h=431770e871&amp;badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=181544" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" title="Video Player"></iframe>`;
            return (
              <div key={idx} style={{ marginBottom: '20px' }}>
                {videoEntry.title && <h4>{promptLookupAIDSpecific(displayPrompts, videoEntry.title, student?.writtenLangPref || 'English', el.parentEvent.aid, el.parentEvent.config.aidAlias, dbgPrompt, dbgout)}</h4>}
                {password && <p><small>Password: {password}</small></p>}
                <div dangerouslySetInnerHTML={{ __html: videoFrame }} />
              </div>
            );
          })}
        </>);
      }
      if (el.subEvent.mediaLink)
        return <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'mediaAccess', student?.writtenLangPref || 'English', el.parentEvent.aid, el.subEvent.mediaLink, undefined, undefined, student, { aid: el.parentEvent.aid }, dbgPrompt, dbgout)} />;
      return <>{promptLookup(displayPrompts, 'mediaNotAvailable', student?.writtenLangPref || 'English', el.parentEvent.aid, dbgPrompt, dbgout)}</>;
    }
  };

  const MediaElementWrapper = ({ el }) => {
    if (!el || !el.key) return null;
    if (el.tag === 'control' || el.tag === 'control-video') {
      const onControlClick = () => { if (el.control) { displayControl[el.control] = !displayControl[el.control]; forceRender(); } };
      const isExpanded = el.control ? !!displayControl[el.control] : false;
      const icon = isExpanded ? faMinus : faPlus;
      const title = promptLookup(displayPrompts, el.eventname, student?.writtenLangPref || 'English', 'dashboard', dbgPrompt, dbgout) || 'Control Section';
      if (el.tag === 'control-video' && !displayControl['video']) return null;
      return (<Fragment key={el.key}> <Card border="dark" text={'white'} bg={el.bg || 'secondary'} onClick={onControlClick} style={{ cursor: "pointer", marginLeft: `${el.indent || 0}px` }} className="mb-3"> <Card.Body><Card.Title><FontAwesomeIcon size="lg" icon={icon} /> {title}</Card.Title></Card.Body> </Card> </Fragment>);
    }
    let parentControlKey = el.tag; let mainCategoryControlKey = el.tag?.startsWith('video-year-') ? 'video' : parentControlKey;
    if (!displayControl[parentControlKey] || (mainCategoryControlKey !== parentControlKey && !displayControl[mainCategoryControlKey])) return null;
    if (el.subEventName === 'translation' && el.prompt) {
      return (<Fragment key={el.key}> <Card border="secondary" text={'white'} bg={'dark'} style={{ marginLeft: `${el.indent || 0}px` }} className="mb-3"> <Card.Body> <Card.Title>Translate: {el.eventname} ({student.writtenLangPref || 'English'})</Card.Title> <p><strong>English:</strong> {el.prompt.english}</p> <Form.Control as="textarea" defaultValue={el.prompt.translation} rows={3} disabled={!languageTransPerms[student.writtenLangPref || 'English']} /> </Card.Body> </Card> </Fragment>);
    }
    console.log("EL:", el);
    const cardTitle = {
      __html: `${el.date ? el.date + ' ' : ''}<br>${el.eventname.__html}${el.subEventDisplayName ? `<br>(${el.subEventDisplayName.__html})` : ''}`
    };
    const descriptionHTML = promptLookupDescription(displayPrompts, `descriptions-${el.parentEvent.aid}-${el.subEventName}`, student?.writtenLangPref || 'English', el.parentEvent.aid, student, el.parentEvent, dbgPrompt, dbgout);

    const emailPrompt = promptLookupAIDSpecific(
      displayPrompts,
      'emailForEvent',
      student?.writtenLangPref || 'English',
      el.parentEvent.aid,
      'dashboard',
      dbgPrompt,
      dbgout
    );

    return (
      <Fragment key={el.key}>
        <Card border="secondary" text={'white'} bg={'dark'} style={{ marginLeft: `${el.indent || 0}px` }} className="mb-3">
          <Card.Body>
            <Card.Title>
              <div dangerouslySetInnerHTML={cardTitle} />
            </Card.Title> <MediaElement el={el} />
          </Card.Body>
          {descriptionHTML && <Card.Text className="p-3"><div dangerouslySetInnerHTML={descriptionHTML} /></Card.Text>}
          <Card.Footer>
            <div dangerouslySetInnerHTML={emailPrompt} />
          </Card.Footer>
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
    return <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'schedule', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />;
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
    }, [student.mid, callDbApi]);

    const numberWithCommas = (x = 0) => (x || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const bumpCount = (field, increment) => {
      setErrorMsg('');
      const currentVal = personalCounts[field] || 0;
      const initialVal = initialPersonalCounts[field] || 0;
      if (increment < 0 && (currentVal + increment < initialVal)) { setErrorMsg("Cannot decrement below saved value."); return; }
      setPersonalCounts(prev => ({ ...prev, [field]: (prev[field] || 0) + increment }));
      setGlobalCounts(prev => ({ ...prev, [`g${field}`]: (prev[`g${field}`] || 0) + increment }));
    };

    return (
      <div>
        {countsLoaded ? (
          <>
            <p>Personal Counts:</p>
            {Object.entries(personalCounts).map(([field, count]) => (
              <p key={field}>{field}: {numberWithCommas(count)}</p>
            ))}
            <p>Global Counts:</p>
            {Object.entries(globalCounts).map(([field, count]) => (
              <p key={field}>{field}: {numberWithCommas(count)}</p>
            ))}
          </>
        ) : (
          <p>{countsLoadStatus}</p>
        )}
        {errorMsg && <p>{errorMsg}</p>}
      </div>
    );
  };

  const EMailPreferences = () => {
    const [preferences, setPreferences] = useState(student.emailPreferences || { videoNotify: true, offering: true, localPractice: false });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handlePreferenceChange = async (key) => {
      try {
        setSaving(true);
        setError('');
        const newPreferences = { ...preferences, [key]: !preferences[key] };
        setPreferences(newPreferences);

        const token = await ensureCsrfToken();
        const response = await fetch('/api/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { [CSRF_HEADER_NAME]: token })
          },
          body: JSON.stringify({
            action: 'updateEmailPreferences',
            payload: {
              id: student.id,
              preferences: newPreferences
            }
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData.data?.err === 'CSRF_TOKEN_MISSING' || errorData.data?.err === 'CSRF_TOKEN_MISMATCH') {
            clearCsrfToken();
            return handlePreferenceChange(key);
          }
          throw new Error(errorData.data?.err || `Failed to update preferences with status ${response.status}`);
        }

        student.emailPreferences = newPreferences;
      } catch (error) {
        console.error('Error updating email preferences:', error);
        setError(error.message);
        // Revert the preference change on error
        setPreferences(student.emailPreferences);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="mt-4">
        <h4>
          <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'emailPreferences', student?.writtenLangPref || 'English', 'dashboard', dbgPrompt, dbgout)} />
        </h4>
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id="videoNotify"
            checked={preferences.videoNotify}
            onChange={() => handlePreferenceChange('videoNotify')}
            disabled={saving}
          />
          <label className="form-check-label" htmlFor="videoNotify">
            {promptLookup(displayPrompts, 'emailPreferencesVideoNotify', student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)}
          </label>
        </div>
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id="offering"
            checked={preferences.offering}
            onChange={() => handlePreferenceChange('offering')}
            disabled={saving}
          />
          <label className="form-check-label" htmlFor="offering">
            {promptLookup(displayPrompts, 'emailPreferencesOffering', student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)}
          </label>
        </div>
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id="localPractice"
            checked={preferences.localPractice}
            onChange={() => handlePreferenceChange('localPractice')}
            disabled={saving}
          />
          <label className="form-check-label" htmlFor="localPractice">
            {promptLookup(displayPrompts, 'emailPreferencesLocalPractice', student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)}
          </label>
        </div>
        {error && <div className="text-danger mt-2">{error}</div>}
      </div>
    );
  };

  return (
    <Container fluid>
      {loaded && (
        <>
          <TopNavBar
            titlePromptKey="title"
            currentLanguage={student.writtenLangPref || 'English'}
            onLanguageChange={(lang) => {
              student.writtenLangPref = lang;
              updateDisplayPrompts();
              forceRender();
            }}
            getPromptText={(key) => promptLookup(displayPrompts, key, student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)}
          />
          {verifyEmail ? (
            <Container className="mt-3">
              <br />
              <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'verifyEmailHeader', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
              <br />
              <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(displayPrompts, 'verifyEmailMessage', student?.writtenLangPref || 'English', currentEventAid, verifyEmail, undefined, undefined, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
            </Container>
          ) : (
            <>
              <br></br>
              <b>{student.first + ' ' + student.last}</b><br></br>
              <b>{student.email}</b><br></br>
              <KMStatus /><br></br>
              <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'msg0', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
              <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'msg1', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
              <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'msg2', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
              <div dangerouslySetInnerHTML={promptLookupHTML(displayPrompts, 'msg3', student?.writtenLangPref || 'English', currentEventAid, student, { aid: currentEventAid }, dbgPrompt, dbgout)} />
              <br></br>
              <MediaList />
              <EMailPreferences />
              <br></br>
            </>
          )}
          <BottomNavBar getPromptText={(key) => promptLookup(displayPrompts, key, student?.writtenLangPref || 'English', currentEventAid, dbgPrompt, dbgout)} />
        </>
      )}
      {!loaded && (
        <div className="text-center p-5">
          <h2>{loadStatus}</h2>
        </div>
      )}
    </Container>
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