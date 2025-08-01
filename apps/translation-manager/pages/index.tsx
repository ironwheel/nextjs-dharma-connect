import React, { useState, useEffect } from "react";
import { useRouter } from 'next/router';
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Card from 'react-bootstrap/Card';

// Import shared components and functions
import {
    TopNavBar,
    BottomNavBar,
    setPrompts,
    setStudent,
    setEvent,
    promptLookup,
    promptLookupAIDSpecific,
    promptLookupHTML,
    dbgout,
    checkEligibility
} from 'sharedFrontend';

// Import API actions
import { api, getAllTableItems, getTableItem } from 'sharedFrontend';

// Global variables
let prompts: any[] = [];
let events: any[] = [];
let pools: any[] = [];
let translationMasterList: any[] = [];
let languageTransPerms: { [key: string]: boolean } = {};
let displayControl: { [key: string]: boolean } = {};
let promptTranslateOpen = false;

// Event object
export let event = { aid: 'dashboard' };

// Student object
export let student: any = {};

const Home = () => {
    const [loaded, setLoaded] = useState(false);
    const [loadStatus, setLoadStatus] = useState("Loading...");
    const [name, setName] = useState("Unknown");
    const [displayPid, setDisplayPid] = useState("Unknown");
    const [email, setEMail] = useState("Unknown");
    const [value, setValue] = useState(0);
    const router = useRouter();
    const { pid, language, hash } = router.query;

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
                    return { data: [] };
                }

                // Filter prompts by aid
                const filteredPrompts = prompts.filter((prompt: any) => prompt.aid === laid);
                return { data: filteredPrompts };
            } catch (error) {
                console.error('Error fetching prompts:', error);
                return { data: [] };
            }
        };

        const fetchLangTransPerms = async (pid: string) => {
            try {
                const perms = await getAllTableItems('langtransperms', pid, hash as string);

                // Check if we got a redirected response
                if (perms && 'redirected' in perms) {
                    console.log('Language translation permissions fetch redirected - authentication required');
                    return { data: {} };
                }

                return { data: perms };
            } catch (error) {
                console.error('Error fetching language translation permissions:', error);
                return { data: {} };
            }
        };

        const fetchPools = async () => {
            try {
                const pools = await getAllTableItems('pools', pid as string, hash as string);

                // Check if we got a redirected response
                if (pools && 'redirected' in pools) {
                    console.log('Pools fetch redirected - authentication required');
                    return { data: [] };
                }

                return { data: pools };
            } catch (error) {
                console.error('Error fetching pools:', error);
                return { data: [] };
            }
        };

        const fetchEvents = async () => {
            try {
                const events = await getAllTableItems('events', pid as string, hash as string);

                // Check if we got a redirected response
                if (events && 'redirected' in events) {
                    console.log('Events fetch redirected - authentication required');
                    return { data: [] };
                }

                return { data: events };
            } catch (error) {
                console.error('Error fetching events:', error);
                return { data: [] };
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
                return { data: { err: 'Failed to fetch participant' } };
            }
        };

        // Initialize data loading
        const initializeData = async () => {
            try {
                // Get prompts
                const gpResponse = await fetchPrompts(event.aid);
                prompts = gpResponse.data;
                setPrompts(prompts);

                // Set language preference
                if (typeof language !== 'undefined') {
                    student.writtenLangPref = language;
                }

                // Get pools
                const poolsResponse = await fetchPools();
                pools = poolsResponse.data;

                // Get events
                const geResponse = await fetchEvents();
                events = geResponse.data;

                // Find participant
                const fpResponse = await fetchParticipant(pid as string);
                student = fpResponse.data;
                setStudent(student);

                if (typeof fpResponse.data.err !== 'undefined') {
                    console.log("FIND STUDENT ERROR: ", fpResponse);
                    setLoadStatus("FIND STUDENT ERROR: " + pid + " " + fpResponse.data.err);
                    return;
                }

                // Note: Translator access is now managed by permitted-hosts entries in the auth table
                // The student.translator check has been removed as per requirements

                // Get translation permissions
                const lpResponse = await fetchLangTransPerms(pid as string);
                if (lpResponse.data && typeof lpResponse.data === 'object' && !Array.isArray(lpResponse.data)) {
                    languageTransPerms = lpResponse.data as { [key: string]: boolean };
                }

                // Set display data
                setName(student.first + ' ' + student.last);
                setDisplayPid(pid as string);
                setEMail(student.email);

                // Update translation list
                updateTranslationList();

                setLoaded(true);
            } catch (err) {
                console.log("Initialization error:", err);
                setLoadStatus("INITIALIZATION ERROR: " + JSON.stringify(err));
            }
        };

        initializeData();
    }, [router.isReady, pid]);

    const forceRender = () => {
        updateTranslationList();
        setValue(value + 1);
    };

    const updateTranslationList = () => {
        translationMasterList = [];

        const compareNames = (a: any, b: any) => {
            // alphabetical
            if (a.displayOrder > b.displayOrder) return 1;
            if (a.displayOrder < b.displayOrder) return -1;
            return 0;
        };

        let language = 'English';
        if (typeof student.writtenLangPref === 'undefined') {
            language = 'English';
        } else {
            language = student.writtenLangPref;
        }

        const descriptionsMasterListIndex = 0;
        let descriptionsEvent = events.find((o: any) => o.aid === 'descriptions');

        if (descriptionsEvent?.config?.translationsOnDeck) {
            // Add descriptions translations control bubble
            if (typeof displayControl['descriptions-translations'] === 'undefined') {
                displayControl['descriptions-translations'] = false;
            }
            translationMasterList.push([]);
            let translationsMasterListIndex = translationMasterList.length - 1;

            let parentEvent = { name: "Event Descriptions" };
            translationMasterList[translationsMasterListIndex].push({
                key: 'translations',
                eventname: 'translationsControlTitle-descriptions',
                tag: 'control',
                control: 'descriptions-translations',
                bg: "secondary",
                subEventDisplayName: null,
                date: '2222-22-22',
                complete: true,
                parentEvent: parentEvent
            });

            // Add prompts for control bubble title
            for (const lang of ['English', 'Czech', 'German', 'Spanish', 'French', 'Portuguese', 'Italian']) {
                prompts.push({
                    prompt: 'dashboard-translationsControlTitle-descriptions',
                    language: lang,
                    aid: 'dashboard',
                    text: 'Event Description Translations',
                    dnt: true
                });
            }
        }

        // Process events for translations
        for (const parentEvent of events) {
            if (parentEvent.config?.translationsOnDeck) {
                let translationsMasterListIndex: number;

                if (parentEvent.aid === 'descriptions') {
                    translationsMasterListIndex = descriptionsMasterListIndex;
                } else {
                    if (typeof displayControl[parentEvent.aid + '-translations'] === 'undefined') {
                        displayControl[parentEvent.aid + '-translations'] = false;
                    }
                    translationMasterList.push([]);
                    translationsMasterListIndex = translationMasterList.length - 1;
                    translationMasterList[translationsMasterListIndex].push({
                        key: 'translations',
                        displayOrder: 'AAAAAA',
                        eventname: 'translationsControlTitle-' + parentEvent.aid,
                        tag: 'control',
                        control: parentEvent.aid + '-translations',
                        bg: parentEvent.config.translationsBG,
                        subEventDisplayName: null,
                        date: '2222-22-22',
                        complete: true,
                        parentEvent: parentEvent
                    });

                    // Add prompts for control bubble title
                    for (const lang of ['English', 'Czech', 'German', 'Spanish', 'French', 'Portuguese', 'Italian']) {
                        prompts.push({
                            prompt: 'dashboard-translationsControlTitle-' + parentEvent.aid,
                            language: lang,
                            aid: 'dashboard',
                            text: 'Prompts Translations: ' + parentEvent.name,
                            dnt: true
                        });
                    }
                }

                // Add prompts for translation
                let promptName: string;
                let promptEnglish: string;
                for (let i = 0; i < prompts.length; i++) {
                    if (!prompts[i]['prompt'].startsWith(parentEvent.aid) ||
                        prompts[i]['language'] !== 'English' ||
                        prompts[i].dnt) {
                        continue;
                    }

                    promptName = prompts[i]['prompt'];
                    promptEnglish = prompts[i]['text'];

                    let prompt = "";
                    let promptIndex = -1;
                    if (language === 'English') {
                        prompt = prompts[i]['text'];
                        promptIndex = i;
                    } else {
                        for (let j = 0; j < prompts.length; j++) {
                            if (prompts[j]['prompt'] !== promptName || prompts[j]['language'] !== language) {
                                continue;
                            }
                            prompt = prompts[j]['text'];
                            promptIndex = j;
                            break;
                        }
                    }

                    let subEvent = {};
                    let promptObject = {
                        name: promptName,
                        english: promptEnglish,
                        translation: prompt,
                        restore: prompt,
                        index: promptIndex,
                        lsb: promptIndex !== -1 ? prompts[promptIndex].lsb : undefined
                    };

                    translationMasterList[translationsMasterListIndex].push({
                        key: prompts[i]['prompt'],
                        displayOrder: prompts[i]['prompt'],
                        tag: parentEvent.aid + '-translations',
                        eventname: prompts[i]['prompt'],
                        subEventDisplayName: null,
                        subEventName: 'translation',
                        date: '2222-22-23',
                        complete: true,
                        parentEvent: parentEvent,
                        subEvent: subEvent,
                        prompt: promptObject
                    });
                }

                translationMasterList[translationsMasterListIndex].sort(compareNames);
            }

            // Add missing descriptions for sub-events
            if (descriptionsEvent?.config?.translationsOnDeck) {
                for (const [subEventName, subEvent] of Object.entries(parentEvent.subEvents || {})) {
                    const subEventObj = subEvent as any;
                    if (typeof subEventObj.eventOnDeck === 'undefined' || !subEventObj.eventOnDeck || subEventName === 'liturgy') {
                        continue;
                    }

                    let promptName = 'descriptions-' + parentEvent.aid + '-' + subEventName;
                    let promptEnglish = "";
                    let found = false;

                    for (let i = 0; i < prompts.length; i++) {
                        if (prompts[i]['aid'] === 'descriptions' &&
                            prompts[i]['prompt'] === promptName &&
                            prompts[i]['language'] === 'English') {
                            promptEnglish = prompts[i]['text'];
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        promptEnglish = "";
                        prompts.push({
                            prompt: promptName,
                            language: 'English',
                            aid: 'descriptions',
                            text: "",
                            dnt: false
                        });
                    }

                    for (const lang of ['Czech', 'German', 'Spanish', 'French', 'Portuguese', 'Italian']) {
                        let found = false;
                        for (let i = 0; i < prompts.length; i++) {
                            if (prompts[i]['aid'] === 'descriptions' &&
                                prompts[i]['prompt'] === promptName &&
                                prompts[i]['language'] === lang) {
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            let promptObject = {
                                name: promptName,
                                english: promptEnglish,
                                translation: "",
                                restore: "",
                                index: -1
                            };
                            prompts.push({
                                prompt: promptName,
                                language: lang,
                                aid: 'descriptions',
                                text: "",
                                dnt: false
                            });
                            promptObject.index = prompts.length - 1;
                            translationMasterList[descriptionsMasterListIndex].push({
                                key: promptName,
                                tag: parentEvent.aid + '-translations',
                                eventname: promptName,
                                subEventDisplayName: null,
                                subEventName: 'translation',
                                date: '2222-22-23',
                                complete: true,
                                parentEvent: parentEvent,
                                subEvent: subEventObj,
                                prompt: promptObject
                            });
                        }
                    }
                }
                translationMasterList[descriptionsMasterListIndex].sort(compareNames);
            }
        }
    };

    const TranslationCard = (el: any) => {
        const [translationUpdate, setTranslationUpdate] = useState(0);
        const [editedText, setEditedText] = useState(el.prompt.translation);

        const handlePromptUpdate = (e: string) => {
            if (!el.prompt.updated && promptTranslateOpen) {
                return;
            }
            el.prompt.translation = e;
            el.prompt.updated = true;
            promptTranslateOpen = true;
            setEditedText(e);
        };

        const handleCancel = () => {
            promptTranslateOpen = false;
            el.prompt.translation = el.prompt.restore;
            el.prompt.updated = false;
            setEditedText(el.prompt.restore);
            forceRender();
        };

        const moveCaretAtEnd = (e: any) => {
            var temp_value = e.target.value;
            e.target.value = '';
            e.target.value = temp_value;
        };

        const writeprompt = async (prompt: string, language: string, laid: string, text: string, lsb: string) => {
            const body = { text: text };
            const response = await api.post(`/api/getprompts/?op=write&prompt=${prompt}&language=${language}&aid=${laid}&lsb=${lsb}`, pid as string, hash as string, body);
            return response;
        };

        const writePrompt = async () => {
            let language = 'English';
            if (typeof student.writtenLangPref === 'undefined') {
                language = 'English';
            } else {
                language = student.writtenLangPref;
            }

            if (el.prompt.index === -1) {
                prompts.push({});
                el.prompt.index = prompts.length - 1;
                prompts[el.prompt.index].prompt = el.prompt.name;
                prompts[el.prompt.index].language = language;
                prompts[el.prompt.index].aid = el.parentEvent.aid;
            }
            prompts[el.prompt.index]['text'] = el.prompt.translation;

            let date = new Date();
            let lsb = student.first + ' ' + student.last + ' ' + date.toISOString();
            prompts[el.prompt.index]['lsb'] = lsb;
            el.prompt.lsb = lsb;

            try {
                await writeprompt(el.prompt.name, language, el.parentEvent.aid, el.prompt.translation, lsb);
                el.prompt.updated = false;
                promptTranslateOpen = false;
                forceRender();
            } catch (err) {
                console.log("writeprompt err:", err);
            }
        };

        const conditionalFooter = () => {
            if (typeof el.prompt.lsb === 'undefined') {
                return null;
            }
            return (
                <Card.Footer >
                    Last saved by {el.prompt.lsb}
                </Card.Footer>
            );
        };

        const conditionalSaveButton = () => {
            if (typeof el.prompt.updated === 'undefined' || !el.prompt.updated) {
                return null;
            }
            let language = 'English';
            if (typeof student.writtenLangPref === 'undefined') {
                language = 'English';
            } else {
                language = student.writtenLangPref;
            }
            if (!languageTransPerms[language]) {
                return null;
            }
            return (
                <>
                    <br></br>
                    <br></br>
                    <Button onClick={writePrompt} type="button" className="dropdown">
                        ✓ <b>Save</b>
                    </Button>
                </>
            );
        };

        const conditionalCancelButton = () => {
            if (typeof el.prompt.updated === 'undefined' || !el.prompt.updated) {
                return null;
            }
            let language = 'English';
            if (typeof student.writtenLangPref === 'undefined') {
                language = 'English';
            } else {
                language = student.writtenLangPref;
            }
            if (!languageTransPerms[language]) {
                return null;
            }
            return (
                <>
                    <Button onClick={handleCancel} type="button" className="dropdown">
                        ✗ <b>Cancel</b>
                    </Button>
                </>
            );
        };

        const conditionalLanguage = () => {
            let language = 'English';
            if (typeof student.writtenLangPref === 'undefined') {
                language = 'English';
            } else {
                language = student.writtenLangPref;
            }
            if (language === 'English') {
                return <>Original</>;
            }
            return <>{language} translation</>;
        };

        const conditionalOriginal = () => {
            let language = 'English';
            if (typeof student.writtenLangPref === 'undefined') {
                language = 'English';
            } else {
                language = student.writtenLangPref;
            }
            if (language === 'English') {
                return null;
            }
            return (
                <>
                    <b>Original</b><br></br><br></br>
                    <textarea className="translation"
                        value={el.prompt.english}
                        rows={4}
                        wrap="true"
                        disabled={true}
                    />
                    <br></br><br></br>
                </>
            );
        };

        // Enforce do not translate
        if (el.prompt.dnt) {
            return null;
        }

        // Don't display translation option when English doesn't exist
        let language = 'English';
        if (typeof student.writtenLangPref === 'undefined') {
            language = 'English';
        } else {
            language = student.writtenLangPref;
        }
        if (language !== 'English' && el.prompt.english.length === 0) {
            return null;
        }

        return (
            <>
                <Card border="dark" text={'dark'} bg={'light'} >
                    <Card.Body>
                        <Card.Title>Prompt name: {el.prompt.name}</Card.Title>
                        <br></br>
                        {conditionalOriginal()}
                        <b>{conditionalLanguage()}</b><br></br><br></br>
                        <textarea className="translation"
                            onChange={(e) => handlePromptUpdate(e.target.value)}
                            onFocus={moveCaretAtEnd}
                            value={editedText}
                            rows={4}
                            wrap="true"
                            disabled={languageTransPerms[language] ? false : true}
                        />
                        {conditionalSaveButton()}&nbsp;&nbsp;&nbsp;&nbsp;{conditionalCancelButton()}
                    </Card.Body>
                    {conditionalFooter()}
                </Card>
                <br></br>
            </>
        );
    };

    const mediaElementWrapper = (el: any) => {
        if (el.tag !== 'control') {
            if (!displayControl[el.tag]) {
                return null;
            }
        }

        const onControlClick = () => {
            displayControl[el.control] = !displayControl[el.control];
            forceRender();
        };

        if (el.tag === 'control') {
            return (
                <>
                    <Card border="dark" text={'white'} bg={el.bg} onClick={onControlClick} style={{ cursor: "pointer" }} >
                        <Card.Body>
                            <Card.Title> {promptLookup(el.eventname)}</Card.Title>
                        </Card.Body>
                    </Card>
                    <br></br>
                </>
            );
        }

        // Handle translations
        if (el.tag.includes('translations')) {
            return TranslationCard(el);
        }

        return null;
    };

    const TranslationList = () => {
        return (
            <>
                {translationMasterList.map((translationList) =>
                    translationList.map((el: any) => mediaElementWrapper(el))
                )}
            </>
        );
    };

    const translationDashboard = () => (
        <>
            <br></br>
            <b>{name}</b><br></br>
            <b>{email}</b><br></br>
            <div dangerouslySetInnerHTML={promptLookupHTML('msg0')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg1')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg2')} />
            <div dangerouslySetInnerHTML={promptLookupHTML('msg3')} />
            <br></br>
            <TranslationList />
            <br></br>
        </>
    );

    if (!loaded) {
        return (
            <Container>
                <br></br>
                <b><div id="load-status">{loadStatus}</div></b>
            </Container>
        );
    }

    return (
        <>
            <TopNavBar updateParent={forceRender} />
            <Container>
                {translationDashboard()}
            </Container>
            <br></br>
        </>
    );
};

export default Home; 