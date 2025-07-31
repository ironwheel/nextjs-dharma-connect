import React, { useState, useEffect, useRef } from 'react'
import { Form, Button, Spinner, Badge } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { getTableItem, putTableItem, deleteTableItem, getAllTableItems, getAllTableItemsFiltered } from 'sharedFrontend'

// Define interfaces for type safety
interface WorkOrder {
    id: string;
    eventCode: string;
    subEvent: string;
    stage: string;
    account?: string;
    zoomId?: string;
    inPerson?: boolean;
    languages?: Record<string, boolean>;
    subjects?: Record<string, string>;
    testers?: string[];
    sendContinuously?: boolean;
    sendUntil?: string;
    sendInterval?: string;
    salutationByName?: boolean;
    regLinkPresent?: boolean;
    createdAt?: string;
    updatedAt?: string;
    locked?: boolean;
    lockedBy?: string | null;
    s3HTMLPaths?: Record<string, string>;
    steps?: Array<{ name: string; status: string; message: string; isActive: boolean }>;
    createdBy?: string;
    config?: { pool?: string };
}

interface Event {
    aid: string;
    name: string;
    config?: {
        emailManager?: boolean;
        pool?: string;
        inPerson?: boolean;
    };
    subEvents?: Record<string, unknown>;
}

interface Stage {
    stage: string;
    description: string;
    order?: number;
    parentStage?: string;
    qaStepCheckZoomId?: boolean;
}

interface InheritedFields {
    s3HTMLPaths?: Record<string, string>;
    languages?: Record<string, boolean>;
    subjects?: Record<string, string>;
}

interface WorkOrderFormProps {
    id?: string
    onSave: (createdWorkOrder?: WorkOrder) => void
    onCancel: () => void
    userPid: string
    userHash: string
}

/**
 * Find the most recent parent work order for inheritance.
 * @param eventCode - The event code to match
 * @param subEvent - The sub event to match
 * @param parentStage - The parent stage to match
 * @param pid - User PID
 * @param hash - User hash
 * @returns The most recent matching parent work order, or null if not found
 */
async function getParentWorkOrder(
    eventCode: string,
    subEvent: string,
    parentStage: string,
    pid: string,
    hash: string
): Promise<WorkOrder | null> {
    // Get all work orders with matching eventCode
    const items = await getAllTableItemsFiltered('work-orders', 'eventCode', eventCode, pid, hash);
    if (!Array.isArray(items) || items.length === 0) return null;
    // Further filter by subEvent and stage == parentStage, allowing archived items
    const filtered = items.filter(item =>
        item.subEvent === subEvent &&
        item.stage === parentStage
    );
    if (filtered.length === 0) return null;
    // Sort by createdAt descending (most recent first)
    filtered.sort((a, b) => {
        const aTime = new Date(a.createdAt || '1970-01-01').getTime();
        const bTime = new Date(b.createdAt || '1970-01-01').getTime();
        return bTime - aTime;
    });
    return filtered[0];
}

/**
 * Get existing work orders for the same event code and sub event to prevent duplicate stage selection.
 * @param eventCode - The event code to match
 * @param subEvent - The sub event to match
 * @param pid - User PID
 * @param hash - User hash
 * @param excludeId - Optional work order ID to exclude from results (for editing)
 * @returns Array of existing work orders with the same eventCode and subEvent
 */
async function getExistingWorkOrders(
    eventCode: string,
    subEvent: string,
    pid: string,
    hash: string,
    excludeId?: string
): Promise<WorkOrder[]> {
    if (!eventCode || !subEvent) return [];

    try {
        // Get all work orders with matching eventCode
        const items = await getAllTableItemsFiltered('work-orders', 'eventCode', eventCode, pid, hash);
        if (!Array.isArray(items) || items.length === 0) return [];

        // Filter by subEvent and include both active and archived work orders
        // Also exclude the current work order if editing
        const filtered = items.filter(item =>
            item.subEvent === subEvent &&
            (!excludeId || item.id !== excludeId)
        );

        return filtered;
    } catch (error) {
        console.error('Error getting existing work orders:', error);
        return [];
    }
}

export default function WorkOrderForm({ id, onSave, onCancel, userPid, userHash }: WorkOrderFormProps) {
    const [loading, setLoading] = useState(false)
    const [events, setEvents] = useState<Event[]>([])
    const [eventCode, setEventCode] = useState('')
    const [subEvents, setSubEvents] = useState<string[]>([])
    const [subEvent, setSubEvent] = useState('')
    const [stage, setStage] = useState('')
    const [languageList, setLanguageList] = useState<string[]>([])
    const [languages, setLanguages] = useState<{ [key: string]: boolean }>({})
    const [subjects, setSubjects] = useState<{ [lang: string]: string }>({})
    const [accountList, setAccountList] = useState<string[]>([])
    const [account, setAccount] = useState('')
    const [zoomId, setZoomId] = useState('')
    const [inPerson, setInPerson] = useState(false)
    const [optionsLoaded, setOptionsLoaded] = useState(false)
    const [testers, setTesters] = useState<string[]>([])
    const [sendContinuously, setSendContinuously] = useState(false)
    const [sendUntil, setSendUntil] = useState('')
    const [sendInterval, setSendInterval] = useState(process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600')
    const [salutationByName, setSalutationByName] = useState(true)  // Default to true
    const [regLinkPresent, setRegLinkPresent] = useState(true)  // Default to true
    const [testParticipantOptions, setTestParticipantOptions] = useState<Array<{ id: string, name: string }>>([])
    const [stages, setStages] = useState<Stage[]>([])
    const [selectedStageRecord, setSelectedStageRecord] = useState<Stage | null>(null)
    const [inheritedFields, setInheritedFields] = useState<InheritedFields>({})
    const [stageValidating, setStageValidating] = useState(false)
    const [existingWorkOrders, setExistingWorkOrders] = useState<WorkOrder[]>([])
    const [loadingExistingWorkOrders, setLoadingExistingWorkOrders] = useState(false)
    const loadedSubEventRef = useRef<string | null>(null)
    const loadedWorkOrderRef = useRef<WorkOrder | null>(null)
    const lastValidationRef = useRef<{ eventCode: string, subEvent: string, stage: string } | null>(null)
    const attemptedStageRef = useRef<string>('')

    // Fetch events and config on mount
    useEffect(() => {
        setLoading(true)
        const loadOptions = async () => {
            try {
                // Load all options in parallel
                const [eventsResp, accountResp, stagesResp, langResp, testIDsResp] = await Promise.all([
                    getAllTableItems('events', userPid, userHash),
                    getTableItem('config', 'emailAccountList', userPid, userHash),
                    getAllTableItems('stages', userPid, userHash),
                    getTableItem('config', 'emailLanguageList', userPid, userHash),
                    getTableItem('config', 'emailTestIDs', userPid, userHash)
                ])

                // Only show events with config.emailManager === true
                const filteredEvents = Array.isArray(eventsResp) ? eventsResp.filter((ev: Event) => ev.config && ev.config.emailManager) : []
                setEvents(filteredEvents)
                setAccountList(accountResp?.value || [])
                setStages(Array.isArray(stagesResp) ? stagesResp : [])
                setLanguageList(langResp?.value || [])

                // Load test participant names
                const testIDs = testIDsResp?.value || []
                const loadTestParticipantNames = async () => {
                    const options: Array<{ id: string, name: string }> = []
                    for (const testID of testIDs) {
                        try {
                            const participant = await getTableItem('students', testID, userPid, userHash)
                            if (participant && (participant.first || participant.last)) {
                                options.push({
                                    id: testID,
                                    name: `${participant.first || ''} ${participant.last || ''}`.trim()
                                })
                            } else {
                                options.push({ id: testID, name: testID })
                            }
                        } catch {
                            options.push({ id: testID, name: testID })
                        }
                    }
                    setTestParticipantOptions(options)
                }
                loadTestParticipantNames()

                if (!id) {
                    setEventCode('') // No event selected by default
                    setSubEvents([])
                    setSubEvent('')
                    setAccount('')
                    setStage('')
                    setLanguages({})
                    setSubjects({})
                }
                setOptionsLoaded(true)
            } catch {
                toast.error('Failed to load form options')
                setOptionsLoaded(true)
            } finally {
                setLoading(false)
            }
        }

        loadOptions()
    }, [])

    // Load work order if editing, but only after options are loaded
    useEffect(() => {
        if (id) {
            getTableItem('work-orders', id, userPid, userHash).then(response => {
                loadedWorkOrderRef.current = response
                if (optionsLoaded) {
                    setEventCode(response.eventCode)
                    loadedSubEventRef.current = response.subEvent
                    setStage(response.stage)
                    setSubjects(response.subjects || {})
                    setAccount(response.account)
                    setLanguages(response.languages || {})
                    setZoomId(response.zoomId || '')
                    setInPerson(response.inPerson || false)
                    setTesters(response.testers || [])
                    setSendContinuously(response.sendContinuously || false)
                    setSendUntil(response.sendUntil || '')
                    setSendInterval(String(response.sendInterval || process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600'))
                    setSalutationByName(response.salutationByName !== false)  // Default to true if not explicitly false
                    setRegLinkPresent(response.regLinkPresent !== false)  // Default to true if not explicitly false
                }
            }).catch(error => {
                console.error('Error loading work order:', error)
                toast.error('Failed to load work order')
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    // When optionsLoaded becomes true, set form state from loaded work order if present
    useEffect(() => {
        if (optionsLoaded && loadedWorkOrderRef.current) {
            const response = loadedWorkOrderRef.current
            setEventCode(response.eventCode)
            loadedSubEventRef.current = response.subEvent
            setStage(response.stage || '')
            setSubjects(response.subjects || {})
            setAccount(response.account || '')
            setLanguages(response.languages || {})
            setZoomId(response.zoomId || '')
            setInPerson(response.inPerson || false)
            setTesters(response.testers || [])
            setSendContinuously(response.sendContinuously || false)
            setSendUntil(response.sendUntil || '')
            setSendInterval(String(response.sendInterval || process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600'))
            setSalutationByName(response.salutationByName !== false)  // Default to true if not explicitly false
            setRegLinkPresent(response.regLinkPresent !== false)  // Default to true if not explicitly false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optionsLoaded])

    // Update sub-events when event changes
    useEffect(() => {
        const selectedEvent = events.find(ev => ev.aid === eventCode)
        if (selectedEvent) {
            const subEvNames = selectedEvent.subEvents ? Object.keys(selectedEvent.subEvents) : []
            setSubEvents(subEvNames)

            // Check if this event is in-person
            const isInPersonEvent = Boolean(selectedEvent.config?.inPerson)
            setInPerson(isInPersonEvent)

            // Only set subEvent if loading from edit and the value is present in the new options
            if (loadedSubEventRef.current && subEvNames.includes(loadedSubEventRef.current)) {
                setSubEvent(loadedSubEventRef.current)
                loadedSubEventRef.current = null
            } else if (!id && subEvNames.length === 1) {
                setSubEvent(subEvNames[0])
            } else if (!id) {
                setSubEvent('')
            } else if (id && !subEvNames.includes(subEvent)) {
                setSubEvent('')
            }
        } else {
            setSubEvents([])
            setSubEvent('')
            setInPerson(false)
        }
    }, [eventCode, events])

    // Load existing work orders when eventCode or subEvent changes
    useEffect(() => {
        if (eventCode && subEvent) {
            setLoadingExistingWorkOrders(true)
            // Pass the current work order ID to exclude it from the results when editing
            getExistingWorkOrders(eventCode, subEvent, userPid, userHash, id)
                .then(workOrders => {
                    setExistingWorkOrders(workOrders)
                })
                .catch(error => {
                    console.error('Error loading existing work orders:', error)
                    setExistingWorkOrders([])
                })
                .finally(() => {
                    setLoadingExistingWorkOrders(false)
                })
        } else {
            setExistingWorkOrders([])
        }
    }, [eventCode, subEvent, userPid, userHash, id])

    // Re-validate parent stage when eventCode or subEvent changes
    useEffect(() => {
        if (stage && selectedStageRecord?.parentStage && eventCode && subEvent) {
            const currentValidation = { eventCode, subEvent, stage }
            const lastValidation = lastValidationRef.current

            // Only re-validate if the event/sub-event combination has actually changed
            if (!lastValidation ||
                lastValidation.eventCode !== eventCode ||
                lastValidation.subEvent !== subEvent) {
                lastValidationRef.current = currentValidation
                handleStageChange(stage)
            }
        }
    }, [eventCode, subEvent])

    // New function to handle stage selection with immediate validation
    const handleStageChange = async (newStage: string) => {
        // Store the attempted stage selection
        attemptedStageRef.current = newStage;

        if (!newStage) {
            setStage('')
            setSelectedStageRecord(null)
            setInheritedFields({})
            return
        }

        // Check if the selected stage is already used in existing work orders
        const isStageUsed = existingWorkOrders.some(wo => wo.stage === newStage)
        if (isStageUsed) {
            toast.error(`Stage '${newStage}' is already used in an existing work order for this event/sub-event combination`)
            return
        }

        const stageRecord = stages.find(s => s.stage === newStage)

        // If stage has parentStage, validate immediately before setting
        if (stageRecord?.parentStage && eventCode && subEvent) {
            setStageValidating(true)
            try {
                // Implement parent work order validation using getParentWorkOrder
                const parentWorkOrder = await getParentWorkOrder(eventCode, subEvent, stageRecord.parentStage, userPid, userHash);
                if (!parentWorkOrder) {
                    toast.error(`No parent work order found for stage '${stageRecord.parentStage}'`);
                    // Don't set the stage - keep current selection
                    attemptedStageRef.current = stage;
                    return;
                }
                // Inherit fields from parent work order
                setStage(newStage)
                setSelectedStageRecord(stageRecord)
                setInheritedFields({
                    s3HTMLPaths: parentWorkOrder.s3HTMLPaths,
                    languages: parentWorkOrder.languages,
                    subjects: parentWorkOrder.subjects
                })
                // Update last validation ref
                lastValidationRef.current = { eventCode, subEvent, stage: newStage }
            } catch (error) {
                console.error('Error finding parent work order:', error)
                toast.error(`Error finding parent work order for stage '${stageRecord.parentStage}'`)
                // Don't set the stage - keep current selection
                attemptedStageRef.current = stage;
            } finally {
                setStageValidating(false)
            }
        } else {
            // No parent stage, proceed normally
            setStage(newStage)
            setSelectedStageRecord(stageRecord || null)
            setInheritedFields({})
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!eventCode || !subEvent || !stage) {
            toast.error('Please fill in all required fields')
            return
        }

        // Final check to ensure the selected stage is not already used
        const isStageUsed = existingWorkOrders.some(wo => wo.stage === stage)
        if (isStageUsed) {
            toast.error(`Cannot create work order: Stage '${stage}' is already used in an existing work order`)
            return
        }

        // Determine if we need to reset steps and show warning
        let shouldResetSteps = false
        let existingSteps: Array<{ name: string, status: string, message: string, isActive: boolean }> = []
        let structuralFieldsChanged = false

        if (id) {
            // When editing, check if structural fields changed
            const existingWorkOrder = loadedWorkOrderRef.current
            if (existingWorkOrder) {
                structuralFieldsChanged =
                    existingWorkOrder.eventCode !== eventCode ||
                    existingWorkOrder.subEvent !== subEvent ||
                    existingWorkOrder.stage !== stage

                shouldResetSteps = structuralFieldsChanged
                existingSteps = existingWorkOrder.steps || []

                // Show warning if structural changes will reset progress
                if (structuralFieldsChanged) {
                    const hasProgress = existingSteps.some(step =>
                        step.status !== 'ready' && step.status !== 'complete'
                    )

                    if (hasProgress) {
                        const confirmed = window.confirm(
                            'Warning: Changing the Event Code, Sub Event, or Stage will reset all workflow progress. ' +
                            'This action cannot be undone. Do you want to continue?'
                        )
                        if (!confirmed) {
                            return
                        }
                    }
                }
            }
        } else {
            // New work order always needs steps initialization
            shouldResetSteps = true
        }

        setLoading(true)
        try {
            // Get the selected event to extract pool configuration
            const selectedEvent = events.find(ev => ev.aid === eventCode)
            const pool = selectedEvent?.config?.pool || ''

            // Initialize or preserve steps
            const steps = shouldResetSteps ? [
                {
                    name: 'Count',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Prepare',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Dry-Run',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Test',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Send',
                    status: 'ready',
                    message: '',
                    isActive: false
                }
            ] : existingSteps

            let workOrderId = id;
            if (!workOrderId) {
                workOrderId = `wo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            }

            const workOrder: WorkOrder = {
                id: workOrderId,
                eventCode,
                subEvent,
                stage,
                languages,
                subjects,
                account,
                createdBy: userPid,
                zoomId,
                inPerson,
                testers,
                sendContinuously,
                sendUntil,
                sendInterval,
                salutationByName,
                regLinkPresent,
                config: {
                    pool: pool
                },
                s3HTMLPaths: inheritedFields.s3HTMLPaths,
                steps: steps,
                locked: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (id) {
                // Add updatedAt for existing work orders
                workOrder.updatedAt = new Date().toISOString()
                await putTableItem('work-orders', workOrderId, workOrder, userPid, userHash)
                if (structuralFieldsChanged) {
                    toast.success('Work order updated - workflow progress has been reset due to structural changes')
                } else {
                    toast.success('Work order updated - workflow progress preserved')
                }
                onSave()
            } else {
                await putTableItem('work-orders', workOrderId, workOrder, userPid, userHash)
                toast.success('Work order created')
                onSave(workOrder) // Pass the created work order back
            }
        } catch {
            toast.error('Failed to save work order')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Form onSubmit={handleSubmit} className="text-light">
            <div className="d-flex justify-content-between align-items-center mb-3">
                {id && (
                    <Button
                        variant="danger"
                        onClick={async () => {
                            if (window.confirm('Are you sure you want to delete this work order?')) {
                                setLoading(true)
                                try {
                                    await deleteTableItem('work-orders', id, userPid, userHash)
                                    toast.success('Work order deleted')
                                    onSave()
                                } catch {
                                    toast.error('Failed to delete work order')
                                } finally {
                                    setLoading(false)
                                }
                            }
                        }}
                        style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                        aria-label="Delete Work Order"
                        disabled={loading}
                    >
                        &#128465;
                    </Button>
                )}
                <div className="d-flex gap-2 align-items-center">
                    <Button variant="secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={loading}>
                        {loading ? (
                            <>
                                <Spinner
                                    as="span"
                                    animation="border"
                                    size="sm"
                                    role="status"
                                    aria-hidden="true"
                                    className="me-2"
                                />
                                Saving...
                            </>
                        ) : (
                            'Save'
                        )}
                    </Button>
                </div>
            </div>
            <Form.Group className="mb-3">
                <Form.Label>Event Code</Form.Label>
                <Form.Select
                    value={eventCode}
                    onChange={e => setEventCode(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select event</option>
                    {events.map(ev => (
                        <option key={ev.aid} value={ev.aid}>{ev.aid} - {ev.name}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Sub Event</Form.Label>
                <Form.Select
                    value={subEvent}
                    onChange={e => setSubEvent(e.target.value)}
                    required
                    disabled={subEvents.length === 1}
                    className="bg-dark text-light border-secondary"
                >
                    {subEvents.length !== 1 && <option value="" disabled>Select sub-event</option>}
                    {subEvents.map(subEv => (
                        <option key={subEv} value={subEv}>{subEv}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Stage</Form.Label>
                <Form.Select
                    value={stageValidating ? attemptedStageRef.current : stage}
                    onChange={e => handleStageChange(e.target.value)}
                    required
                    disabled={stageValidating || loadingExistingWorkOrders}
                    className="bg-dark text-light border-secondary"
                >
                    <option value="">Select Stage</option>
                    {stages
                        .slice() // copy array to avoid mutating state
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                        .map(st => {
                            // Check if this stage is already used in existing work orders
                            const isStageUsed = existingWorkOrders.some(wo => wo.stage === st.stage)
                            return (
                                <option
                                    key={st.stage}
                                    value={st.stage}
                                    disabled={isStageUsed}
                                >
                                    {st.stage} - {st.description}
                                    {isStageUsed ? ' (Already used)' : ''}
                                </option>
                            )
                        })}
                </Form.Select>
                {stageValidating && (
                    <Form.Text className="text-info">
                        <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                        />
                        Validating parent stage...
                    </Form.Text>
                )}
                {loadingExistingWorkOrders && (
                    <Form.Text className="text-info">
                        <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                        />
                        Checking for existing work orders...
                    </Form.Text>
                )}
                {existingWorkOrders.length > 0 && (
                    <Form.Text className="text-warning">
                        Found {existingWorkOrders.length} existing work order(s) for this event/sub-event combination.
                        Used stages are disabled to prevent duplicates.
                        {(() => {
                            const usedStages = [...new Set(existingWorkOrders.map(wo => wo.stage))]
                            return usedStages.length > 0 ? ` Used stages: ${usedStages.join(', ')}` : ''
                        })()}
                    </Form.Text>
                )}
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        This stage inherits content from parent stage: {selectedStageRecord.parentStage}
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Languages</Form.Label>
                <div className="d-flex flex-wrap gap-3">
                    {languageList.map(lang => (
                        <Form.Check
                            key={lang}
                            type="checkbox"
                            id={`lang-${lang}`}
                            label={lang}
                            checked={Boolean(languages[lang])}
                            onChange={e => setLanguages(langs => ({ ...langs, [lang]: e.target.checked }))}
                            disabled={Boolean(selectedStageRecord?.parentStage)}
                            className="bg-dark text-light border-secondary"
                        />
                    ))}
                </div>
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        Languages are inherited from parent stage and cannot be modified
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Subjects</Form.Label>
                {Object.keys(languages).filter(l => languages[l]).map(lang => (
                    <div key={lang} className="mb-2">
                        <Form.Label>{lang.toUpperCase()}</Form.Label>
                        <Form.Control
                            type="text"
                            value={subjects[lang] || ''}
                            onChange={e => setSubjects(s => ({ ...s, [lang]: e.target.value }))}
                            placeholder={`Subject for ${lang.toUpperCase()}`}
                            disabled={Boolean(selectedStageRecord?.parentStage)}
                            className="bg-dark text-light border-secondary mb-2"
                        />
                    </div>
                ))}
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        Subjects are inherited from parent stage and cannot be modified
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Account</Form.Label>
                <Form.Select
                    value={account}
                    onChange={e => setAccount(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select account</option>
                    {accountList.map(acc => (
                        <option key={acc} value={acc}>{acc}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            {selectedStageRecord?.qaStepCheckZoomId && (
                <Form.Group className="mb-3">
                    {inPerson ? (
                        <>
                            <Form.Label>Event Type</Form.Label>
                            <div className="form-control bg-dark text-light border-secondary" style={{ padding: '0.375rem 0.75rem', backgroundColor: '#212529', color: '#fff' }}>
                                <Badge bg="success" className="me-2">In-Person</Badge>
                                This is an in-person event - no Zoom ID required
                            </div>
                        </>
                    ) : (
                        <>
                            <Form.Label>Zoom ID</Form.Label>
                            <Form.Control
                                type="text"
                                value={zoomId}
                                onChange={e => setZoomId(e.target.value)}
                                placeholder="Enter Zoom ID"
                                className="bg-dark text-light border-secondary"
                                required
                            />
                            <Form.Text className="text-muted">
                                Required for this stage
                            </Form.Text>
                        </>
                    )}
                </Form.Group>
            )}

            <Form.Group className="mb-3">
                <Form.Label>Testers</Form.Label>
                <Form.Select
                    multiple
                    value={testers}
                    onChange={e => {
                        const selectedOptions = Array.from(e.target.selectedOptions, option => option.value)
                        setTesters(selectedOptions)
                    }}
                    className="bg-dark text-light border-secondary"
                >
                    {testParticipantOptions.map(option => (
                        <option key={option.id} value={option.id}>
                            {option.name}
                        </option>
                    ))}
                </Form.Select>
                <Form.Text className="text-muted">
                    Select one or more testers to receive test emails (hold Ctrl/Cmd to select multiple)
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="salutationByName"
                    label="Salutation By Name"
                    checked={salutationByName}
                    onChange={e => setSalutationByName(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, the Prepare step will check for the ||name|| field in HTML content
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="regLinkPresent"
                    label="Registration Link Present"
                    checked={regLinkPresent}
                    onChange={e => setRegLinkPresent(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, the Prepare step will check for registration links with proper parameters
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="sendContinuously"
                    label="Enable Continuous Sending"
                    checked={sendContinuously}
                    onChange={e => setSendContinuously(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, emails will be sent continuously until the specified date
                </Form.Text>
            </Form.Group>

            {sendContinuously && (
                <Form.Group className="mb-3">
                    <Form.Label>Send Until Date</Form.Label>
                    <Form.Control
                        type="datetime-local"
                        value={sendUntil}
                        onChange={e => setSendUntil(e.target.value)}
                        className="bg-dark text-light border-secondary"
                        required={sendContinuously}
                    />
                    <Form.Text className="text-muted">
                        Continuous sending will stop on this date and time
                    </Form.Text>
                </Form.Group>
            )}

            {sendContinuously && (
                <Form.Group className="mb-3">
                    <Form.Label>Send Interval</Form.Label>
                    <Form.Select
                        value={sendInterval}
                        onChange={e => setSendInterval(e.target.value)}
                        className="bg-dark text-light border-secondary"
                        required={sendContinuously}
                    >
                        <option value="3600">1 hour</option>
                        <option value="600">10 minutes</option>
                    </Form.Select>
                    <Form.Text className="text-muted">
                        Time to wait between sending passes
                    </Form.Text>
                </Form.Group>
            )}
        </Form>
    )
} 