import React, { useState, useEffect } from "react";
import { useRouter } from 'next/router';
import { createPortal } from 'react-dom';
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Form from "react-bootstrap/Form";
import Card from 'react-bootstrap/Card';
import ReactSrcDocIframe from 'react-srcdoc-iframe';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faPlus, faMinus, faTimes, faPlusCircle, faMinusCircle, faUser, faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import Pusher from 'pusher-js';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

// Import shared components and functions
import {
    TopNavBar,
    BottomNavBar,
    ColoredLine,
    ThickColoredLine,
    setPrompts,
    setStudent,
    setEvent,
    promptLookup,
    promptLookupAIDSpecific,
    promptLookupHTML,
    promptLookupHTMLAIDSpecific,
    promptLookupDescription,
    promptLookupHTMLWithArgs,
    promptLookupHTMLWithArgsAIDSpecific,
    dbgout,
    checkEligibility,
    getFingerprint
} from 'sharedFrontend';

// Import API actions
import { api, getAllTableItems, getTableItem, updateTableItem } from 'sharedFrontend';

// Global variables
let prompts: any[] = [];
let events: any[] = [];
let pools: any[] = [];
let eventList: any[] = [];
let liturgyList: any[] = [];
let videoList: any[] = [];
let videoListByYear: { [key: string]: any[] } = {};
let showcaseMasterList: any[] = [];
let mantraList: any[] = [];
let scheduleList: any[] = [];
let displayControl: { [key: string]: boolean } = {
    'control': true,
    'event': false,
    'liturgy': false,
    'video': true,
    'mantra': false,
    'schedule': false
};
let displayVideoControl: { [key: string]: boolean } = {};
let pusherChannels: any = false;
let pusherChannel: any = false;

// Event object
export let event = { aid: 'dashboard' };

// Student object
export let student: any = {};

const IFrame = ({ children, ...props }: any) => {
    const [contentRef, setContentRef] = useState<HTMLIFrameElement | null>(null);
    const mountNode = contentRef?.contentWindow?.document?.body;

    return (
        <iframe {...props} ref={setContentRef}>
            {mountNode && createPortal(children, mountNode)}
        </iframe>
    );
};

const Home = () => {
    const [loaded, setLoaded] = useState(false);
    const [loadStatus, setLoadStatus] = useState("Loading...");
    const [name, setName] = useState("Unknown");
    const [displayPid, setDisplayPid] = useState("Unknown");
    const [email, setEMail] = useState("Unknown");
    const [kmStatus, setKMStatus] = useState(false);
    const [kmCache, setKMCache] = useState(null);
    const [value, setValue] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const { pid, language, showcase, hash } = router.query;
    const REGCOMPLETE_WEBHOOK_CHANNEL = 'regcomplete';

    event.aid = 'dashboard';

    useEffect(() => {
        if (!router.isReady) return;

        // API functions using standardized table operations
        const fetchPrompts = async (laid: string) => {
            try {
                const prompts = await getAllTableItems('prompts', pid as string, hash as string);

                // Check if we got a redirected response
                if (prompts && 'redirected' in prompts) {
                    console.log('Prompts fetch redirected - authentication required');
                    return { data: [], error: 'Authentication required' };
                }

                // Filter prompts by aid
                const filteredPrompts = prompts.filter((prompt: any) => prompt.aid === laid);
                return { data: filteredPrompts };
            } catch (error) {
                console.error('Error fetching prompts:', error);
                return { data: [], error: error instanceof Error ? error.message : 'Unknown error fetching prompts' };
            }
        };

        const fetchPools = async () => {
            try {
                const pools = await getAllTableItems('pools', pid as string, hash as string);

                // Check if we got a redirected response
                if (pools && 'redirected' in pools) {
                    console.log('Pools fetch redirected - authentication required');
                    return { data: [], error: 'Authentication required' };
                }

                return { data: pools };
            } catch (error) {
                console.error('Error fetching pools:', error);
                return { data: [], error: error instanceof Error ? error.message : 'Unknown error fetching pools' };
            }
        };

        const fetchEvents = async () => {
            try {
                const events = await getAllTableItems('events', pid as string, hash as string);

                // Check if we got a redirected response
                if (events && 'redirected' in events) {
                    console.log('Events fetch redirected - authentication required');
                    return { data: [], error: 'Authentication required' };
                }

                return { data: events };
            } catch (error) {
                console.error('Error fetching events:', error);
                return { data: [], error: error instanceof Error ? error.message : 'Unknown error fetching events' };
            }
        };

        const fetchParticipant = async (pid: string) => {
            try {
                const participant = await getTableItem('students', pid, pid, hash as string);

                // Check if we got a redirected response
                if (participant && 'redirected' in participant) {
                    console.log('Participant fetch redirected - authentication required');
                    return { data: { err: 'Authentication required' } };
                }

                return { data: participant };
            } catch (error) {
                console.error('Error fetching participant:', error);
                return { data: { err: error instanceof Error ? error.message : 'Failed to fetch participant' } };
            }
        };

        const updateStudentEventField = async (studentId: string, fieldName: string, fieldValue: any) => {
            if (!event || !event.aid) {
                console.error('No current event selected');
                return false;
            }
            const eventFieldName = `programs.${event.aid}.${fieldName}`;
            try {
                const result = await updateTableItem('students', studentId, eventFieldName, fieldValue, pid as string, hash as string);

                // Check if we got a redirected response
                if (result && 'redirected' in result) {
                    console.log('Student event field update redirected - authentication required');
                    return false;
                }

                console.log('Field updated successfully');
                return true;
            } catch (error) {
                console.error('Error updating student event field:', error);
                return false;
            }
        };

        // Initialize data loading
        const initializeData = async () => {
            try {
                // Get prompts
                const gpResponse = await fetchPrompts(event.aid);
                if (gpResponse.error) {
                    console.error('Error fetching prompts:', gpResponse.error);
                    setError("PROMPTS FETCH ERROR: " + gpResponse.error);
                    setLoadStatus("Error loading data. Please check your authentication.");
                    return;
                }
                prompts = gpResponse.data;
                setPrompts(prompts);

                // Set language preference
                if (typeof language !== 'undefined') {
                    student.writtenLangPref = language;
                }

                // Get pools
                const poolsResponse = await fetchPools();
                if (poolsResponse.error) {
                    console.error('Error fetching pools:', poolsResponse.error);
                    setError("POOLS FETCH ERROR: " + poolsResponse.error);
                    setLoadStatus("Error loading data. Please check your authentication.");
                    return;
                }
                pools = poolsResponse.data;

                // Get events
                const geResponse = await fetchEvents();
                if (geResponse.error) {
                    console.error('Error fetching events:', geResponse.error);
                    setError("EVENTS FETCH ERROR: " + geResponse.error);
                    setLoadStatus("Error loading data. Please check your authentication.");
                    return;
                }
                events = geResponse.data;

                // Find participant
                const fpResponse = await fetchParticipant(pid as string);
                student = fpResponse.data;
                setStudent(student);

                if (typeof fpResponse.data.err !== 'undefined') {
                    console.log("FIND STUDENT ERROR: ", fpResponse);
                    setError("FIND STUDENT ERROR: " + pid + " " + fpResponse.data.err);
                    setLoadStatus("Error loading data. Please check your authentication.");
                    return;
                }

                // Set default email preferences
                if (typeof student.emailPreferences == 'undefined') {
                    student.emailPreferences = { videoNotify: true, offering: true, localPractice: false };
                }

                // Record dashboard visit
                if (typeof student.programs[event.aid] === 'undefined') {
                    student.programs[event.aid] = {};
                }
                const date = new Date();
                if (typeof student.programs[event.aid].clickCount === 'undefined') {
                    student.programs[event.aid].clickCount = 0;
                }
                student.programs[event.aid].clickTime = date.toISOString();
                student.programs[event.aid].clickCount += 1;
                await updateStudentEventField(pid as string, 'clickCount', student.programs[event.aid].clickCount);
                await updateStudentEventField(pid as string, 'clickTime', student.programs[event.aid].clickTime);

                // Set display data
                setName(student.first + ' ' + student.last);
                setDisplayPid(pid as string);
                setEMail(student.email);
                setKMStatus(typeof student.kmCache !== 'undefined');
                if (typeof student.kmCache !== 'undefined') {
                    setKMCache(student.kmCache);
                }

                // Update media list
                updateMediaList();

                // Setup Pusher for real-time updates
                try {
                    pusherChannels = new Pusher("0ecad01bb9fe0977da61", { cluster: 'mt1' });
                    pusherChannel = pusherChannels.subscribe(REGCOMPLETE_WEBHOOK_CHANNEL);
                    pusherChannel.bind(pid, function (data: any) {
                        console.log("WEBHOOK:", data);
                        setLoaded(false);
                        fetchParticipant(pid as string).then((fpResponse) => {
                            student = fpResponse.data;
                            setStudent(student);
                            if (typeof fpResponse.data.err !== 'undefined') {
                                console.log("FIND STUDENT ERROR: ", fpResponse);
                                setError("FIND STUDENT ERROR: " + pid + " " + fpResponse.data.err);
                                setLoadStatus("Error loading data. Please check your authentication.");
                            } else {
                                updateMediaList();
                                setError(null);
                                setLoaded(true);
                            }
                        }).catch((err) => {
                            console.log("fetchParticipant err:", err);
                            setError("FETCHPARTICIPANT ERROR: " + JSON.stringify(err));
                            setLoadStatus("Error loading data. Please check your authentication.");
                        });
                    });
                } catch (err) {
                    console.log("PUSHER SETUP ERR:", err);
                    // Don't fail the entire initialization for Pusher errors
                }

                setError(null);
                setLoaded(true);
            } catch (err) {
                console.log("Initialization error:", err);
                setError("INITIALIZATION ERROR: " + JSON.stringify(err));
                setLoadStatus("Error loading data. Please check your authentication.");
            }
        };

        initializeData();
    }, [router.isReady, pid]);

    const forceRender = () => {
        updateMediaList();
        setValue(value + 1);
    };

    const updateMediaList = () => {
        // Reset all lists
        liturgyList = [];
        videoList = [];
        videoListByYear = {};
        showcaseMasterList = [];
        eventList = [];

        // Add control items
        eventList.push({
            key: 'current',
            eventname: 'controlTitleEvents',
            tag: 'control',
            control: 'event',
            subEventDisplayName: null,
            date: '2222-22-22',
            complete: false,
            bg: 'primary',
            indent: 0
        });

        liturgyList.push({
            key: 'liturgies',
            eventname: 'controlTitleLiturgies',
            tag: 'control',
            control: 'liturgy',
            subEventDisplayName: null,
            date: '2222-22-22',
            complete: true,
            bg: 'primary',
            indent: 0
        });

        videoList.push({
            key: 'videos',
            eventname: 'controlTitleVideos',
            tag: 'control',
            control: 'video',
            subEventDisplayName: null,
            date: '2222-22-22',
            complete: true,
            bg: 'success',
            indent: 0
        });

        mantraList.push({
            key: 'mantra',
            eventname: 'controlTitleMantraCounter',
            tag: 'control',
            control: 'mantra',
            subEventDisplayName: null,
            date: '2222-22-22',
            complete: true,
            bg: 'primary',
            indent: 0
        });

        scheduleList.push({
            key: 'schedule',
            eventname: 'controlTitleSchedule',
            tag: 'control',
            control: 'schedule',
            subEventDisplayName: null,
            date: '2222-22-22',
            complete: true,
            bg: 'primary',
            indent: 0
        });

        const compareDates = (a: any, b: any) => {
            // latest first
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            return 0;
        };

        const compareNames = (a: any, b: any) => {
            // alphabetical
            if (a.displayOrder > b.displayOrder) return 1;
            if (a.displayOrder < b.displayOrder) return -1;
            return 0;
        };

        // Process events
        for (const parentEvent of events) {
            // Skip events without subEvents
            if (typeof parentEvent.subEvents === 'undefined') {
                continue;
            }

            // Check eligibility
            if (!checkEligibility(parentEvent.config.pool, student, parentEvent.aid, pools)) {
                continue;
            }

            // Set regional coordinator email
            if (student.country === "United States" ||
                student.country === "Canada" ||
                student.country === "Mexico" ||
                student.country === "Chile" ||
                student.country === "Brazil") {
                parentEvent.coordEmail = parentEvent.config.coordEmailAmericas;
            } else {
                parentEvent.coordEmail = parentEvent.config.coordEmailEurope;
            }

            // Process showcase events
            if (typeof parentEvent.showcaseVideoList !== 'undefined') {
                if (typeof displayControl[parentEvent.aid + '-showcase'] === 'undefined') {
                    displayControl[parentEvent.aid + '-showcase'] = false;
                }
                showcaseMasterList.push([]);
                let showcaseMasterListIndex = showcaseMasterList.length - 1;
                showcaseMasterList[showcaseMasterListIndex].push({
                    key: 'showcase',
                    eventname: parentEvent.showcaseControlTitle,
                    tag: 'control',
                    control: parentEvent.aid + '-showcase',
                    subEventDisplayName: null,
                    date: '2222-22-22',
                    complete: true,
                    parentEvent: parentEvent,
                    bg: 'success',
                    indent: 16
                });

                // Add showcase videos
                for (const showcaseElement of parentEvent.showcaseVideoList) {
                    for (const pev of events) {
                        if (pev.aid == showcaseElement.aid) {
                            if (typeof pev.subEvents[showcaseElement.subevent] !== 'undefined') {
                                let eventName = promptLookupAIDSpecific(pev.aid, pev.config.aidAlias, 'title');
                                var subEventDisplayName;
                                if (Object.keys(pev.subEvents).length == 1) {
                                    subEventDisplayName = null;
                                } else {
                                    subEventDisplayName = promptLookupAIDSpecific(pev.aid, pev.config.aidAlias, showcaseElement.subevent);
                                }
                                showcaseMasterList[showcaseMasterListIndex].push({
                                    key: pev.name + showcaseElement.subevent,
                                    tag: parentEvent.aid + '-showcase',
                                    eventname: eventName,
                                    subEventDisplayName: subEventDisplayName,
                                    subEventName: showcaseElement.subevent,
                                    date: pev.subEvents[showcaseElement.subevent].date,
                                    complete: true,
                                    parentEvent: pev,
                                    subEvent: pev.subEvents[showcaseElement.subevent]
                                });
                            }
                        }
                    }
                }
                showcaseMasterList[showcaseMasterListIndex].sort(compareDates);
                continue;
            }

            // Process sub-events
            for (const [subEventName, subEvent] of Object.entries(parentEvent.subEvents)) {
                const subEventObj = subEvent as any; // Cast to any to access properties
                var subEventDisplayName;
                if (Object.keys(parentEvent.subEvents).length == 1) {
                    subEventDisplayName = null;
                } else {
                    subEventDisplayName = promptLookupAIDSpecific(parentEvent.aid, parentEvent.config.aidAlias, subEventName);
                }

                if (typeof subEventObj.eventOnDeck === 'undefined' || !subEventObj.eventOnDeck) {
                    continue;
                }

                let eventName = promptLookupAIDSpecific(parentEvent.aid, parentEvent.config.aidAlias, 'title');

                if (subEventObj.eventComplete) {
                    if (typeof subEventObj.embeddedPDFList !== 'undefined') {
                        liturgyList.push({
                            key: parentEvent.name + subEventName,
                            tag: 'liturgy',
                            eventname: eventName,
                            subEventDisplayName: subEventDisplayName,
                            subEventName: subEventName,
                            date: subEventObj.date,
                            complete: subEventObj.eventComplete,
                            parentEvent: parentEvent,
                            subEvent: subEventObj
                        });
                    } else {
                        // Add to year-specific video list
                        const year = subEventObj.date.substring(0, 4);
                        if (!videoListByYear[year]) {
                            videoListByYear[year] = [];
                        }
                        videoListByYear[year].push({
                            key: parentEvent.name + subEventName,
                            tag: `video-year-${year}`,
                            eventname: eventName,
                            subEventDisplayName: subEventDisplayName,
                            subEventName: subEventName,
                            date: subEventObj.date,
                            complete: subEventObj.eventComplete,
                            parentEvent: parentEvent,
                            subEvent: subEventObj
                        });
                    }
                } else {
                    eventList.push({
                        key: parentEvent.name + subEventName,
                        aid: parentEvent.aid,
                        tag: 'event',
                        eventname: eventName,
                        subEventDisplayName: subEventDisplayName,
                        subEventName: subEventName,
                        date: subEventObj.date,
                        complete: subEventObj.eventComplete,
                        parentEvent: parentEvent,
                        subEvent: subEventObj
                    });
                }
            }
        }

        // Sort all lists
        eventList.sort(compareDates);
        liturgyList.sort(compareDates);
        videoList.sort(compareDates);
        Object.values(videoListByYear).forEach(list => list.sort(compareDates));
    };

    // Continue with the rest of the component...

    const KMStatus = () => {
        if (!kmStatus) {
            return (
                <>
                    <div dangerouslySetInnerHTML={promptLookupHTML('rcpNoAccount')} />
                </>
            );
        } else {
            return (
                <>
                    {promptLookup('rcpAccountFound')}
                </>
            );
        }
    };

    const DisplayEmailIFrame = (el: any, state: string, prompt?: string) => {
        const [iFrameData, setIFrameData] = useState("<p>Loading...</p>");
        const [englishOnlyNote, setEnglishOnlyNote] = useState<string | null>(null);

        useEffect(() => {
            if (typeof el.subEvent.embeddedEmails[state] === 'undefined') {
                return;
            }

            let language = 'English';
            if (typeof student.writtenLangPref !== 'undefined') {
                language = student.writtenLangPref;
            }

            let pageLink: string | undefined;
            if (typeof el.subEvent.embeddedEmails[state][language] !== 'undefined') {
                pageLink = el.subEvent.embeddedEmails[state][language];
            } else {
                if (language != 'English') {
                    if (el.subEvent.embeddedEmails[state]['English'] !== 'undefined') {
                        pageLink = el.subEvent.embeddedEmails[state]['English'];
                        setEnglishOnlyNote(promptLookup('emailLanguageNotAvailable'));
                    }
                }
            }

            if (pageLink) {
                fetch(pageLink).then((response) => {
                    response.text().then((pageData) => {
                        pageData = pageData.replace(/\|\|name\|\|/g, student.first + ' ' + student.last);
                        pageData = pageData.replace(/\|\|coord-email\|\|/g, el.parentEvent.coordEmail);
                        pageData = pageData.replace(/123456789/g, pid as string);
                        setIFrameData(pageData);
                    }).catch((err) => {
                        setIFrameData("<p>Error: Embedded Email fails: " + JSON.stringify(err) + "</p>");
                    });
                });
            }
        }, []);

        return (
            <>
                {englishOnlyNote ? <>{englishOnlyNote} <br></br></> : null}
                <ReactSrcDocIframe srcDoc={iFrameData} width="640" height="360" frameBorder="1" />
            </>
        );
    };

    const mediaElement = (el: any) => {
        // Not offered, build reg link
        let regLink = "https://reg.slsupport.link/?pid=" + pid + "&aid=" + el.parentEvent.aid + "&callback=" + REGCOMPLETE_WEBHOOK_CHANNEL;

        const ConditionalEMail = (state: string, prompt?: string) => {
            if (typeof el.subEvent.embeddedEmails === 'undefined') {
                return null;
            }
            if (!el.subEvent.embeddedEmails[state]) {
                return null;
            }

            if (state == 'accept' && el.subEvent.embeddedEmails['reg-confirm']) {
                state = 'reg-confirm';
            }

            return (
                <>
                    {DisplayEmailIFrame(el, state, prompt)}
                </>
            );
        };

        if (!el.complete) {
            // Event is today or in the future, treat it as a live event
            const ConditionalTimes = () => {
                if (typeof el.subEvent.timeString === 'undefined') {
                    return null;
                } else {
                    return (
                        <>
                            <div dangerouslySetInnerHTML={{ __html: el.subEvent.timeString }} />
                        </>
                    );
                }
            };

            // Check if registered
            if (el.parentEvent.config.offeringPresentation !== 'installments' &&
                typeof student.programs[el.parentEvent.aid] !== 'undefined' &&
                typeof student.programs[el.parentEvent.aid].offeringHistory !== 'undefined' &&
                typeof student.programs[el.parentEvent.aid].offeringHistory[el.subEventName] !== 'undefined') {

                const ConditionalZoomLink = () => {
                    if (el.parentEvent.config.inPerson) {
                        return null;
                    }
                    if (typeof el.subEvent.zoomLink === 'undefined') {
                        return (
                            <>
                                {promptLookup('zoomLinkNotAvailable')}
                            </>
                        );
                    } else {
                        return (
                            <>
                                <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('zoomLink', el.subEvent.zoomLink, el.subEvent.zoomLink)} />
                            </>
                        );
                    }
                };

                return (
                    <>
                        <ConditionalTimes />
                        <div dangerouslySetInnerHTML={promptLookupHTML('eventRegistered')} />
                        <ConditionalZoomLink />
                        {ConditionalEMail('reg-confirm')}
                    </>
                );
            } else {
                // Not registered - show registration options
                if (el.parentEvent.config.offeringPeriodClosed) {
                    return (
                        <>
                            <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('offeringPeriodClosed', el.parentEvent.coordEmail)} />
                        </>
                    );
                }

                if (el.parentEvent.config.needAcceptance) {
                    // Handle acceptance required events
                    if (typeof student.programs[el.parentEvent.aid] !== 'undefined' && student.programs[el.parentEvent.aid].accepted) {
                        return (
                            <>
                                <ConditionalTimes />
                                <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('acceptedNotOffered', regLink)} />
                                {ConditionalEMail('reg')}
                            </>
                        );
                    } else {
                        if (typeof student.programs[el.parentEvent.aid] !== 'undefined' && student.programs[el.parentEvent.aid].join) {
                            return (
                                <>
                                    <ConditionalTimes />
                                    <div dangerouslySetInnerHTML={promptLookupHTML('notAccepted')} />
                                    {ConditionalEMail('reg', 'recent')}
                                </>
                            );
                        } else {
                            if (el.parentEvent.config.applicationPeriodClosed) {
                                return (
                                    <>
                                        <ConditionalTimes />
                                        <div dangerouslySetInnerHTML={promptLookupHTML('applicationPeriodClosed')} />
                                    </>
                                );
                            }

                            if (el.subEvent.regLinkAvailable) {
                                return (
                                    <>
                                        <ConditionalTimes />
                                        <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('notApplied', regLink)} />
                                        {ConditionalEMail('reg')}
                                    </>
                                );
                            } else {
                                return (
                                    <>
                                        <ConditionalTimes />
                                        <div dangerouslySetInnerHTML={promptLookupHTML('registrationNotOpen')} />
                                        {ConditionalEMail('std')}
                                    </>
                                );
                            }
                        }
                    }
                } else {
                    // No acceptance needed
                    if (el.subEvent.noRegRequired) {
                        let emailState = 'reg-confirm';
                        if (null === ConditionalEMail('reg-confirm')) {
                            emailState = 'reg';
                        }
                        return (
                            <>
                                <ConditionalTimes />
                                {ConditionalEMail(emailState)}
                            </>
                        );
                    }

                    if (el.subEvent.regLinkAvailable) {
                        return (
                            <>
                                <ConditionalTimes />
                                <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('eventRegister', regLink)} />
                                {ConditionalEMail('reg')}
                            </>
                        );
                    } else {
                        return (
                            <>
                                <ConditionalTimes />
                                <div dangerouslySetInnerHTML={promptLookupHTML('registrationNotOpen')} />
                                {ConditionalEMail('std')}
                            </>
                        );
                    }
                }
            }
        }

        // Event is completed - show media
        if (!el.subEvent.embeddedVideoList && !el.subEvent.embeddedPDFList) {
            return (
                <>
                    {promptLookup('mediaNotAvailable')}
                </>
            );
        }

        // Check if offering is complete
        let offeringComplete = false;
        let offeringCompleteAID = false;

        if (el.parentEvent.config.eligibleOnlyMediaAccess) {
            offeringComplete = true;
            offeringCompleteAID = el.parentEvent.aid;
        } else {
            if (typeof student.programs[el.parentEvent.aid] !== 'undefined' &&
                typeof student.programs[el.parentEvent.aid].offeringHistory !== 'undefined') {
                if (el.parentEvent.config.offeringPresentation !== 'installments') {
                    if (typeof student.programs[el.parentEvent.aid].offeringHistory[el.subEventName] !== 'undefined') {
                        offeringComplete = true;
                        offeringCompleteAID = el.parentEvent.aid;
                    }
                } else {
                    if (typeof student.programs[el.parentEvent.aid].offeringHistory.retreat !== 'undefined' &&
                        typeof student.programs[el.parentEvent.aid].offeringHistory.retreat.offeringSKU !== 'undefined') {
                        offeringComplete = true;
                        offeringCompleteAID = el.parentEvent.aid;
                    }
                }
            }
        }

        if (!offeringComplete) {
            // Check for companion events
            if (typeof el.subEvent.offeringCompanionAID !== 'undefined' &&
                typeof el.subEvent.offeringCompanionSubEvent !== 'undefined') {
                if (typeof student.programs[el.subEvent.offeringCompanionAID] !== 'undefined') {
                    if (typeof student.programs[el.subEvent.offeringCompanionAID].offeringHistory !== 'undefined') {
                        if (typeof student.programs[el.subEvent.offeringCompanionAID].offeringHistory[el.subEvent.offeringCompanionSubEvent] !== 'undefined') {
                            offeringComplete = true;
                            offeringCompleteAID = el.subEvent.offeringCompanionAID;
                        }
                    }
                }
            }
        }

        if (!offeringComplete) {
            if (typeof el.parentEvent.config.mediaAttendeesOnly !== 'undefined' && el.parentEvent.config.mediaAttendeesOnly) {
                return (
                    <>
                        <div dangerouslySetInnerHTML={promptLookupHTML('mediaAttendeesOnly')} />
                    </>
                );
            }

            if (el.subEvent.embeddedPDFList) {
                const ConditionalPrintedLiturgyAvailable = () => {
                    if (typeof el.subEvent.kalapaMediaPrintLink === 'undefined') {
                        return null;
                    }
                    return (
                        <>
                            <div dangerouslySetInnerHTML={promptLookupHTMLWithArgsAIDSpecific(el.parentEvent.aid, 'mediaOfferingPrint', el.subEvent.kalapaMediaPrintLink)} />
                        </>
                    );
                };
                return (
                    <>
                        <div dangerouslySetInnerHTML={promptLookupHTMLAIDSpecific(el.parentEvent.aid, 'mediaOfferingDescription')} />
                        {ConditionalPrintedLiturgyAvailable()}
                        <div dangerouslySetInnerHTML={promptLookupHTMLWithArgsAIDSpecific(el.parentEvent.aid, 'mediaOfferingPDF', regLink)} />
                        {ConditionalEMail('reg')}
                    </>
                );
            }
            return (
                <>
                    <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('mediaOffering', regLink)} />
                    {ConditionalEMail('reg')}
                </>
            );
        }

        // Show media content
        if (typeof el.subEvent.embeddedVideoList !== 'undefined') {
            let language = 'English';
            if (typeof student.writtenLangPref !== 'undefined') {
                language = student.writtenLangPref;
            }

            const embeddedVideo = (v: any) => {
                const ConditionalVideoTitle = () => {
                    if (typeof v.title === 'undefined') {
                        return null;
                    }
                    return (
                        <>
                            <br></br>
                            <i>{promptLookupAIDSpecific(el.parentEvent.aid, el.parentEvent.aid, v.title)}</i> <br></br>
                        </>
                    );
                };

                const ConditionalVideoFrame = (videoId: string, videoFrame: string, password: string) => {
                    const onControlClickVideo = () => {
                        displayVideoControl[videoId] = !displayVideoControl[videoId];
                        forceRender();
                    };

                    const videoControlBubble = () => {
                        return (
                            <>
                                <Card style={{ cursor: "pointer", width: "640px" }} border="light" text={'white'} bg={'success'} onClick={onControlClickVideo} >
                                    <Card.Body>
                                        <Card.Title>
                                            <FontAwesomeIcon size="lg" icon={displayVideoControl[videoId] ? faMinus : faPlus}></FontAwesomeIcon>
                                            {displayVideoControl[videoId] ? promptLookup("videoClose") : promptLookup("videoOpen")}
                                        </Card.Title>
                                    </Card.Body>
                                </Card>
                            </>
                        );
                    };

                    if (!displayVideoControl[videoId]) {
                        return videoControlBubble();
                    } else {
                        return (
                            <>
                                {videoControlBubble()}
                                {promptLookup('videoPassword')} {password} <br></br>
                                {<div dangerouslySetInnerHTML={{ __html: videoFrame }} />}
                            </>
                        );
                    }
                };

                let embeddedLink: string | undefined;
                let englishOnlyNote: string | null = null;

                if (typeof v[language] !== 'undefined') {
                    embeddedLink = v[language];
                } else {
                    if (language != 'English') {
                        if (v['English'] !== 'undefined') {
                            embeddedLink = v['English'];
                            englishOnlyNote = promptLookup('videoLanguageNotAvailable');
                        }
                    }
                }

                if (embeddedLink) {
                    let password = v['password'] || el.subEvent.embeddedVideoListPassword;
                    let videoFrame = "<iframe src=\"https://player.vimeo.com/video/videoid?h=431770e871&amp;badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=181544\" width=\"640\" height=\"360\" frameborder=\"0\" allowfullscreen></iframe>";
                    videoFrame = videoFrame.replace("videoid", embeddedLink);

                    return (
                        <>
                            {englishOnlyNote ? <>{englishOnlyNote} <br></br></> : null}
                            {ConditionalVideoTitle()}
                            {ConditionalVideoFrame(embeddedLink, videoFrame, password)}
                        </>
                    );
                }
            };

            return (
                <>
                    {el.subEvent.embeddedVideoList.map((vid: any) => embeddedVideo(vid))}
                </>
            );
        }

        if (typeof el.subEvent.embeddedPDFList !== 'undefined') {
            let language = 'English';
            if (typeof student.writtenLangPref !== 'undefined') {
                language = student.writtenLangPref;
            }

            const embeddedPDF = (v: any) => {
                let embeddedLink: string | undefined;
                let englishOnlyNote: string | null = null;

                if (typeof v[language] !== 'undefined') {
                    embeddedLink = v[language];
                } else {
                    if (language != 'English') {
                        if (v['English'] !== 'undefined') {
                            embeddedLink = v['English'];
                            englishOnlyNote = promptLookup('videoLanguageNotAvailable');
                        }
                    }
                }

                if (embeddedLink) {
                    const renderToolbar = (Toolbar: any) => (
                        <Toolbar>
                            {(slots: any) => {
                                const {
                                    CurrentPageInput,
                                    Download,
                                    EnterFullScreen,
                                    GoToNextPage,
                                    GoToPreviousPage,
                                    NumberOfPages,
                                    Print,
                                    ShowSearchPopover,
                                    Zoom,
                                    ZoomIn,
                                    ZoomOut,
                                } = slots;
                                return (
                                    <div style={{ alignItems: 'center', display: 'flex', width: '100%' }}>
                                        <div style={{ padding: '0px 2px' }}>
                                            <ShowSearchPopover />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <ZoomOut />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <Zoom />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <ZoomIn />
                                        </div>
                                        <div style={{ padding: '0px 2px', marginLeft: 'auto' }}>
                                            <GoToPreviousPage />
                                        </div>
                                        <div style={{ padding: '0px 2px', width: '4rem' }}>
                                            <CurrentPageInput />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            / <NumberOfPages />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <GoToNextPage />
                                        </div>
                                        <div style={{ padding: '0px 2px', marginLeft: 'auto' }}>
                                            <EnterFullScreen />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <Download />
                                        </div>
                                        <div style={{ padding: '0px 2px' }}>
                                            <Print />
                                        </div>
                                    </div>
                                );
                            }}
                        </Toolbar>
                    );

                    const defaultLayoutPluginInstance = defaultLayoutPlugin({
                        sidebarTabs: (defaultTabs) => [],
                        renderToolbar
                    });

                    return (
                        <>
                            <br></br>
                            {englishOnlyNote ? <>{englishOnlyNote} <br></br></> : null}
                            <Worker workerUrl={`https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.js`}>
                                <div style={{ height: '750px' }}>
                                    <Viewer
                                        fileUrl={embeddedLink}
                                        plugins={[defaultLayoutPluginInstance]}
                                    />
                                </div>
                            </Worker>
                            <br></br>
                        </>
                    );
                }
            };

            return (
                <>
                    {el.subEvent.embeddedPDFList.map((pdf: any) => embeddedPDF(pdf))}
                </>
            );
        }

        if (typeof el.subEvent.mediaLink !== 'undefined') {
            return (
                <>
                    <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('mediaAccess', el.mediaLink)} />
                </>
            );
        }

        return (
            <>
                Error: Media Link for on deck video is undefined.
            </>
        );
    };

    const mediaElementWrapper = (el: any) => {
        if (el.tag !== 'control' && el.tag !== 'control-video') {
            if (!displayControl[el.tag]) {
                return null;
            }
        }

        const conditionalIntroduction = () => {
            let promptName;
            if (el.offeringCompleteAID && (el.offeringCompleteAID !== el.parentEvent.aid)) {
                promptName = 'DashboardIntroductionCompanion';
            } else {
                promptName = 'DashboardIntroduction';
            }

            promptName = el.subEventName + promptName;

            let introductionText = promptLookupAIDSpecific(el.parentEvent.aid, el.parentEvent.config.aidAlias, promptName);
            if (introductionText.includes('unknown')) {
                return null;
            }

            if (introductionText.includes('||id||')) {
                introductionText = introductionText.replace("||id||", pid as string);
            }

            return (
                <>
                    <div dangerouslySetInnerHTML={{ __html: introductionText }} />
                </>
            );
        };

        const conditionalDescription = () => {
            const descriptionText = promptLookupDescription(el.parentEvent.aid + '-' + el.subEventName);
            if (descriptionText === null) {
                return null;
            }
            return (
                <>
                    <Card.Footer >
                        <div dangerouslySetInnerHTML={descriptionText} />
                    </Card.Footer>
                </>
            );
        };

        const eventDate = () => {
            if (el.tag === 'liturgy') {
                return null;
            }
            return (
                <>
                    {el.date}
                    <br></br>
                </>
            );
        };

        const subEventName = () => {
            if (el.subEventDisplayName === null) {
                return null;
            }
            return (
                <>
                    <br></br>
                    ({el.subEventDisplayName})
                </>
            );
        };

        const onControlClick = () => {
            displayControl[el.control] = !displayControl[el.control];
            forceRender();
        };

        if (el.tag === 'control' || el.tag === 'control-video') {
            const LiturgiesIntro = () => {
                if (!displayControl['liturgy'] || el.control !== 'liturgy' || liturgyList.length === 1) {
                    return null;
                }
                return (
                    <>
                        <div dangerouslySetInnerHTML={promptLookupHTML('liturgiesIntro')} />
                        <br></br>
                    </>
                );
            };

            const ShowcaseIntro = () => {
                if (el.key !== 'showcase' || !displayControl[el.parentEvent.aid + '-showcase']) {
                    return null;
                }
                return (
                    <>
                        <div dangerouslySetInnerHTML={promptLookupHTML(el.parentEvent.showcaseIntro)} />
                        <br></br>
                    </>
                );
            };

            if (el.tag === 'control-video') {
                if (!displayControl['video']) {
                    return null;
                }
                return (
                    <>
                        <Card style={{ cursor: "pointer", marginLeft: el.indent }} border="light" text={'white'} bg={'success'} onClick={onControlClick}  >
                            <Card.Body>
                                <Card.Title>
                                    <FontAwesomeIcon size="lg" icon={displayControl[el.control] ? faMinus : faPlus}></FontAwesomeIcon>
                                    {promptLookup(el.eventname)}
                                </Card.Title>
                            </Card.Body>
                        </Card>
                        <br></br>
                        {LiturgiesIntro()}
                        {ShowcaseIntro()}
                    </>
                );
            }

            return (
                <>
                    <Card border="dark" text={'white'} bg={el.bg} onClick={onControlClick} style={{ cursor: "pointer", marginLeft: el.indent }} >
                        <Card.Body>
                            <Card.Title>
                                <FontAwesomeIcon size="lg" icon={displayControl[el.control] ? faMinus : faPlus}></FontAwesomeIcon>
                                {promptLookup(el.eventname)}
                            </Card.Title>
                        </Card.Body>
                    </Card>
                    <br></br>
                    {LiturgiesIntro()}
                    {ShowcaseIntro()}
                </>
            );
        }

        // Handle offering completion check
        let offeringComplete = false;
        let offeringCompleteAID = false;

        if (el.parentEvent.config.eligibleOnlyMediaAccess) {
            offeringComplete = true;
            offeringCompleteAID = el.parentEvent.aid;
        } else {
            if (typeof student.programs[el.parentEvent.aid] !== 'undefined' &&
                typeof student.programs[el.parentEvent.aid].offeringHistory !== 'undefined') {
                if (el.parentEvent.config.offeringPresentation !== 'installments') {
                    if (typeof student.programs[el.parentEvent.aid].offeringHistory[el.subEventName] !== 'undefined') {
                        offeringComplete = true;
                        offeringCompleteAID = el.parentEvent.aid;
                    }
                } else {
                    if (typeof student.programs[el.parentEvent.aid].offeringHistory.retreat !== 'undefined' &&
                        typeof student.programs[el.parentEvent.aid].offeringHistory.retreat.offeringSKU !== 'undefined') {
                        offeringComplete = true;
                        offeringCompleteAID = el.parentEvent.aid;
                    }
                }
            }
        }

        if (!offeringComplete) {
            if (typeof el.subEvent.offeringCompanionAID !== 'undefined' &&
                typeof el.subEvent.offeringCompanionSubEvent !== 'undefined') {
                if (typeof student.programs[el.subEvent.offeringCompanionAID] !== 'undefined') {
                    if (typeof student.programs[el.subEvent.offeringCompanionAID].offeringHistory !== 'undefined') {
                        if (typeof student.programs[el.subEvent.offeringCompanionAID].offeringHistory[el.subEvent.offeringCompanionSubEvent] !== 'undefined') {
                            offeringComplete = true;
                            offeringCompleteAID = el.subEvent.offeringCompanionAID;
                        }
                    }
                }
            }
        }

        el.offeringComplete = offeringComplete;
        el.offeringCompleteAID = offeringCompleteAID;

        return (
            <>
                <Card border="dark" text={'dark'} bg={'light'} >
                    <Card.Body>
                        <Card.Title>{eventDate()}{el.eventname}{subEventName()}</Card.Title>
                        {conditionalIntroduction()}
                        {mediaElement(el)}
                    </Card.Body>
                    {conditionalDescription()}
                    <Card.Footer >
                        <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('emailForEvent', el.parentEvent.coordEmail, el.parentEvent.coordEmail)} />
                    </Card.Footer>
                </Card>
                <br></br>
            </>
        );
    };

    const Schedule = () => {
        if (!displayControl['schedule']) {
            return null;
        }
        return (
            <>
                <div dangerouslySetInnerHTML={promptLookupHTML('schedule')} />
            </>
        );
    };

    const displayVideoList = (list: any[]) => {
        if (!displayControl['video']) {
            return null;
        }
        return (
            <>
                {list.map((el) => mediaElementWrapper(el))}
            </>
        );
    };

    const MediaList = () => {
        return (
            <>
                {eventList.map((el) => mediaElementWrapper(el))}
                {liturgyList.length > 1 ? liturgyList.map((el) => mediaElementWrapper(el)) : null}
                {videoList.map((el) => mediaElementWrapper(el))}
                {showcaseMasterList.map((showcaseList) => displayVideoList(showcaseList))}
                {Object.entries(videoListByYear).map(([year, list]) => displayVideoList(list))}
                {mediaElementWrapper(scheduleList[0])}
                {Schedule()}
                {mediaElementWrapper(mantraList[0])}
            </>
        );
    };

    const EMailPreferences = () => {
        const [videoNotify, setVideoNotify] = useState(student.emailPreferences?.videoNotify || true);
        const [offering, setOffering] = useState(student.emailPreferences?.offering || true);
        const [localPractice, setLocalPractice] = useState(student.emailPreferences?.localPractice || false);

        const writestudentemailpreferences = async (lpid: string, lstudent: any) => {
            const body = { 'student': lstudent };
            const response = await api.post(`/api/student/?op=emailwrite&pid=${lpid}`, pid as string, hash as string, body);
            return response;
        };

        const handleEMailPreferences = (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!student.emailPreferences) {
                student.emailPreferences = {};
            }
            student.emailPreferences[e.target.name] = e.target.checked;
            writestudentemailpreferences(pid as string, student);
            if (e.target.name === 'videoNotify') {
                setVideoNotify(e.target.checked);
            } else if (e.target.name === 'offering') {
                setOffering(e.target.checked);
            } else if (e.target.name === 'localPractice') {
                setLocalPractice(e.target.checked);
            }
        };

        return (
            <>
                <div dangerouslySetInnerHTML={promptLookupHTML('emailPreferences')} />
                <Form.Group as={Row} controlId="EMailPreferences">
                    <Form.Label column lg={10}>
                        <Form.Check autoFocus={false} inline onChange={handleEMailPreferences} checked={videoNotify} name={'videoNotify'} label={promptLookup("emailPreferencesVideoNotify")} type={'checkbox'} id={"checkbox-VN"} />
                        <Form.Check autoFocus={false} inline onChange={handleEMailPreferences} checked={offering} name={'offering'} label={promptLookup("emailPreferencesOffering")} type={'checkbox'} id={"checkbox-Offering"} />
                        <Form.Check autoFocus={false} inline onChange={handleEMailPreferences} checked={localPractice} name={'localPractice'} label={promptLookup("emailPreferencesLocalPractice")} type={'checkbox'} id={"checkbox-LP"} />
                    </Form.Label>
                </Form.Group>
                <br></br>
            </>
        );
    };

    const mediaDashboard = () => (
        <>
            <br></br>
            <b>{name}</b><br></br>
            <b>{email}</b><br></br>
            <KMStatus /><br></br>
            <div dangerouslySetInnerHTML={promptLookupHTML('msg0')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg1')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg2')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg3')} />
            <br></br>
            <MediaList />
            <EMailPreferences />
            <br></br>
        </>
    );

    if (!loaded) {
        return (
            <Container>
                <br></br>
                <b><div id="load-status">{loadStatus}</div></b>
                {error && (
                    <div style={{
                        backgroundColor: '#f8d7da',
                        color: '#721c24',
                        padding: '15px',
                        marginTop: '15px',
                        border: '1px solid #f5c6cb',
                        borderRadius: '4px'
                    }}>
                        <strong>Error Details:</strong><br />
                        {error}
                    </div>
                )}
            </Container>
        );
    }

    return (
        <>
            <TopNavBar updateParent={forceRender} />
            <Container>
                {mediaDashboard()}
            </Container>
            <br></br>
        </>
    );
};

export default Home; 