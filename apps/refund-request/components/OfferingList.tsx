import React, { useState, useEffect } from 'react';
import { Button, Card, Table, Form, Modal, Spinner, Badge } from 'react-bootstrap';
import { getTableItemOrNull, api, authGetConfigValue } from 'sharedFrontend';
import { toast } from 'react-toastify';


interface OfferingListProps {
    student: any;
}

const OfferingList: React.FC<OfferingListProps> = ({ student }) => {
    const [processing, setProcessing] = useState<string | null>(null);
    const [eventsData, setEventsData] = useState<Record<string, any>>({}); // Store full event objects
    const [filterTerm, setFilterTerm] = useState('');
    const [creds, setCreds] = useState<{ pid: string, hash: string } | null>(null);

    // Add state for modal
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [refundCandidate, setRefundCandidate] = useState<any | null>(null);
    const [stripeDetails, setStripeDetails] = useState<any | null>(null);
    const [loadingStripe, setLoadingStripe] = useState(false);
    const [reason, setReason] = useState('');
    const [refundRequests, setRefundRequests] = useState<Record<string, { approvalState: string, approverName?: string }>>({});
    const [userEventAccess, setUserEventAccess] = useState<string[]>([]);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
            setCreds({ pid, hash });
        }
    }, []);

    // 1. Initial Extraction (Raw Data)
    const extractOfferings = () => {
        const offerings: any[] = [];
        if (!student.programs) return offerings;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        Object.entries(student.programs).forEach(([progId, progData]: [string, any]) => {
            if (progData.offeringHistory) {
                Object.entries(progData.offeringHistory).forEach(([eventId, offData]: [string, any]) => {
                    const offeringDate = offData.offeringTime ? new Date(offData.offeringTime) : null;
                    if (offeringDate && offeringDate >= sixMonthsAgo) {
                        offerings.push({
                            programId: progId,
                            eventId: eventId,
                            ...offData
                        });
                    }
                });
            }
        });
        return offerings;
    };

    const rawOfferings = extractOfferings();

    // 2. Fetch Event Metadata & Check Existing Refunds
    useEffect(() => {
        if (!creds || rawOfferings.length === 0) return;

        const fetchEvents = async () => {
            const uniqueProgramIds = Array.from(new Set(rawOfferings.map(o => o.programId)));
            const newEventsData: Record<string, any> = { ...eventsData };

            let changed = false;
            for (const progId of uniqueProgramIds) {
                if (!newEventsData[progId]) {
                    try {
                        const event = await getTableItemOrNull('events', progId, creds.pid, creds.hash);
                        if (event) {
                            newEventsData[progId] = event;
                            changed = true;
                        } else {
                            newEventsData[progId] = { name: progId, notFound: true };
                            changed = true;
                        }
                    } catch (e) {
                        newEventsData[progId] = { name: progId, error: true };
                        changed = true;
                    }
                }
            }
            if (changed) setEventsData(newEventsData);
        };

        const checkRefunds = async () => {
            const intentIds = rawOfferings.map(o => o.offeringIntent).filter(Boolean);
            if (intentIds.length === 0) return;
            try {
                const res = await api.post('/api/refunds/check', creds.pid, creds.hash, { paymentIntentIds: intentIds });
                setRefundRequests(res.refundRequests || {});
            } catch (e) {
                console.error("Failed to check existing refunds", e);
            }
        };

        const fetchEventAccess = async () => {
            try {
                const eventAccessResult = await authGetConfigValue(creds.pid, creds.hash, 'eventAccess');
                if (Array.isArray(eventAccessResult)) {
                    setUserEventAccess(eventAccessResult);
                } else {
                    console.log('No event access restrictions found (or invalid format), showing no events');
                    setUserEventAccess([]);
                }
            } catch (error: any) {
                if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                    console.log('Event access not configured for user, showing no events');
                } else {
                    console.error('Error fetching event access:', error);
                }
                setUserEventAccess([]);
            }
        };

        fetchEvents();
        checkRefunds();
        fetchEventAccess();
    }, [student, creds]); // rawOfferings derived from student, so implicit dependency

    // 3. Process, Enrich, Filter, and Sort Offerings
    const processOfferings = () => {
        const enriched = rawOfferings.map(off => {
            const eventData = eventsData[off.programId];
            const eventName = eventData?.name || off.programId;

            // Extract Subevent Date
            let subEventDate = null;
            if (eventData && eventData.subEvents && eventData.subEvents[off.eventId] && eventData.subEvents[off.eventId].date) {
                subEventDate = eventData.subEvents[off.eventId].date;
            }

            return {
                ...off,
                eventName,
                subEventDate
            };
        });

        const filtered = enriched.filter(off => {
            // Event Access Logic
            if (!userEventAccess.includes('all')) {
                // If 'all' is not present, we must match the eventId (programId in this context usually map to aid)
                // In data model: off.programId seems to match event aid based on extraction login
                if (!userEventAccess.includes(off.programId)) {
                    return false;
                }
            }

            const searchLower = filterTerm.toLowerCase();
            return (
                (off.eventName && off.eventName.toLowerCase().includes(searchLower)) ||
                (off.eventId && off.eventId.toLowerCase().includes(searchLower)) ||
                (off.offeringSKU && off.offeringSKU.toLowerCase().includes(searchLower)) ||
                (off.offeringIntent && off.offeringIntent.toLowerCase().includes(searchLower))
            );
        });

        // Sort by Subevent Date (desc), fallback to Offering Date (desc)
        return filtered.sort((a, b) => {
            const dateStrA = a.subEventDate;
            const dateStrB = b.subEventDate;
            const timeA = dateStrA ? new Date(dateStrA).getTime() : (a.offeringTime ? new Date(a.offeringTime).getTime() : 0);
            const timeB = dateStrB ? new Date(dateStrB).getTime() : (b.offeringTime ? new Date(b.offeringTime).getTime() : 0);
            return timeB - timeA;
        });
    };

    const displayOfferings = processOfferings();

    const initiateRefund = async (offering: any) => {
        setRefundCandidate(offering);
        setStripeDetails(null);
        setLoadingStripe(true);
        setShowRefundModal(true);
        setReason(''); // Reset reason

        // Fetch stripe details
        if (offering.offeringIntent) {
            try {
                if (creds) {
                    const data = await api.get(`/api/stripe/retrieve?id=${offering.offeringIntent}`, creds.pid, creds.hash);
                    setStripeDetails(data);
                }
            } catch (error: any) {
                console.error("Failed to fetch stripe details", error);
                toast.error(error.message || "Could not retrieve transaction details from Stripe.");
            } finally {
                setLoadingStripe(false);
            }
        } else {
            setLoadingStripe(false);
        }
    };

    const cancelRefund = () => {
        setRefundCandidate(null);
        setStripeDetails(null);
        setShowRefundModal(false);
    };

    const confirmRefund = async () => {
        if (!refundCandidate) return;

        if (reason.length < 10) {
            toast.error("Please provide a reason (at least 10 characters).");
            return;
        }

        const { offeringIntent, programId, eventId } = refundCandidate;

        setProcessing(offeringIntent);

        if (!creds) return;

        try {
            await api.post('/api/refunds/request', creds.pid, creds.hash, {
                stripePaymentIntent: offeringIntent,
                pid: student.id,
                eventCode: programId,
                subEvent: eventId,
                reason
            });
            toast.success("Refund request submitted successfully!");
            setRefundRequests((prev: Record<string, { approvalState: string, approverName?: string }>) => ({
                ...prev,
                [offeringIntent]: { approvalState: 'PENDING' }
            }));
            setShowRefundModal(false);
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || err.details?.error || "Request failed");
        } finally {
            setProcessing(null);
            setRefundCandidate(null);
            setStripeDetails(null);
        }
    };

    return (
        <>
            <Card className="bg-dark text-white border-secondary">
                <Card.Header className="border-secondary d-flex justify-content-between align-items-center">
                    <span>Offering History for {student.first} {student.last}</span>
                    <Badge bg="secondary">{student.id}</Badge>
                </Card.Header>
                <Card.Body>
                    <Form.Group className="mb-3">
                        <Form.Control
                            type="text"
                            placeholder="Filter history..."
                            value={filterTerm}
                            onChange={e => setFilterTerm(e.target.value)}
                            className="bg-dark text-white border-secondary"
                        />
                    </Form.Group>

                    {displayOfferings.length === 0 ? (
                        <p className="text-muted">No matching offerings found.</p>
                    ) : (
                        <Table striped bordered hover size="sm" variant="dark">
                            <thead>
                                <tr>
                                    <th>Event</th>
                                    <th>Subevent</th>
                                    <th>Event Date</th>
                                    <th>Offering Time</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayOfferings.map((off, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            {off.eventName}
                                            {off.eventName !== off.programId && (
                                                <div className="text-muted small" style={{ fontSize: '0.75em' }}>{off.programId}</div>
                                            )}
                                        </td>
                                        <td>
                                            {['event', 'retreat'].includes(off.eventId.toLowerCase()) ? '' : off.eventId}
                                        </td>
                                        <td>
                                            {(() => {
                                                if (!off.subEventDate) return '-';
                                                const [y, m, d] = off.subEventDate.split('-');
                                                if (!y || !m || !d) return off.subEventDate;
                                                const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                return `${d}-${months[parseInt(m, 10) - 1]}-${y}`;
                                            })()}
                                        </td>
                                        <td>{off.offeringTime || '-'}</td>
                                        <td>
                                            {(() => {
                                                const request = refundRequests[off.offeringIntent];
                                                if (request) {
                                                    if (request.approvalState === 'COMPLETE') {
                                                        return <Badge bg="success">Refunded by {request.approverName || 'Admin'}</Badge>;
                                                    }
                                                    if (request.approvalState === 'DENY' || request.approvalState === 'DENIED') {
                                                        return <Badge bg="danger">Denied by {request.approverName || 'Admin'}</Badge>;
                                                    }
                                                    if (request.approvalState === 'ERROR') {
                                                        return <Badge bg="danger">Error</Badge>;
                                                    }
                                                    // Default or PENDING
                                                    return <Button variant="secondary" size="sm" disabled>Request Pending</Button>;
                                                }

                                                if (off.offeringIntent) {
                                                    return (
                                                        <Button
                                                            variant="warning"
                                                            size="sm"
                                                            disabled={processing === off.offeringIntent}
                                                            onClick={() => initiateRefund(off)}
                                                        >
                                                            {processing === off.offeringIntent ? 'Processing...' : 'Request Refund'}
                                                        </Button>
                                                    );
                                                }

                                                return null;
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card.Body>
            </Card>

            {/* Refund Confirmation Modal */}
            <Modal show={showRefundModal} onHide={cancelRefund} size="lg" centered>
                <Modal.Header closeButton className="bg-dark text-white border-secondary">
                    <Modal.Title>Confirm Request</Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-white">
                    {refundCandidate && (
                        <div>
                            <p className="lead text-center">Please confirm the following refund details</p>
                            <div className="my-4 p-3 border border-secondary rounded bg-secondary bg-opacity-10">
                                <div className="mb-2"><strong>Student:</strong> {student.first} {student.last}</div>
                                <div className="mb-2"><strong>Email:</strong> {student.email}</div>
                                <div className="mb-2"><strong>Event:</strong> {refundCandidate.eventName}</div>
                                <div className="mb-2"><strong>Subevent:</strong> {refundCandidate.eventId}</div>

                                {loadingStripe ? (
                                    <div className="mb-2 text-info">
                                        <Spinner animation="border" size="sm" className="me-2" />
                                        Fetching transaction details...
                                    </div>
                                ) : stripeDetails ? (
                                    <>
                                        <hr className="border-secondary my-2" />
                                        <div className="mb-1 text-uppercase small text-muted">Stripe Details</div>
                                        <div className="mb-2">
                                            <strong>Amount:</strong> <span className="text-success fs-5 me-2">${(stripeDetails.amount / 100).toFixed(2)}</span>
                                            {stripeDetails.currency.toUpperCase()}
                                        </div>
                                        {stripeDetails.description && (
                                            <div className="mb-2"><strong>Description:</strong> {stripeDetails.description}</div>
                                        )}
                                        {/* Card Details from expanded payment_method */}
                                        {stripeDetails.payment_method && stripeDetails.payment_method.card && (
                                            <div className="mb-2">
                                                <strong>Card:</strong> {stripeDetails.payment_method.card.brand.toUpperCase()} •••• {stripeDetails.payment_method.card.last4}
                                                <br />
                                                <small className="text-muted">
                                                    Expires: {stripeDetails.payment_method.card.exp_month}/{stripeDetails.payment_method.card.exp_year} | {stripeDetails.payment_method.card.country}
                                                </small>
                                            </div>
                                        )}
                                        {stripeDetails.status !== 'succeeded' && (
                                            <div className="mb-2"><strong>Status:</strong> {stripeDetails.status}</div>
                                        )}
                                        <div className="mb-2 small text-muted">ID: {stripeDetails.id}</div>
                                    </>
                                ) : (
                                    <div className="mb-2 text-warning">
                                        <small>Could not fetch details. Using stored amount:</small><br />
                                        <strong>Amount:</strong> <span className="text-success fs-5">${(refundCandidate?.offeringAmount / 100).toFixed(2)}</span> {refundCandidate?.offeringCurrency?.toUpperCase() || 'USD'}
                                    </div>
                                )}
                            </div>

                            <Form.Group className="mb-3">
                                <Form.Label>Reason (Required)</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Enter reason for refund request (min 10 chars)..."
                                    className="bg-secondary text-white border-secondary bg-opacity-25"
                                />
                            </Form.Group>

                            <p className="text-muted small fst-italic text-center">This action will submit a refund request for approval.</p>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer className="bg-dark border-secondary">
                    <Button variant="secondary" onClick={cancelRefund}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={confirmRefund} disabled={loadingStripe || (!stripeDetails && !refundCandidate?.offeringAmount) || reason.length < 10}>
                        Confirm Request
                    </Button>
                </Modal.Footer>
            </Modal >
        </>
    );
};

export default OfferingList;
