import React, { useState, useEffect } from 'react';
import { Modal, Button, Spinner, Form, Badge } from 'react-bootstrap';
import { api, getTableItemOrNull } from 'sharedFrontend';
import { toast } from 'react-toastify';

interface ApprovalModalProps {
    show: boolean;
    onHide: () => void;
    refund: any;
    creds: { pid: string, hash: string };
    onComplete: () => void;
}

const ApprovalModal: React.FC<ApprovalModalProps> = ({ show, onHide, refund, creds, onComplete }) => {
    const [stripeDetails, setStripeDetails] = useState<any | null>(null);
    const [loadingStripe, setLoadingStripe] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Confirmation States
    const [showConfirmDeny, setShowConfirmDeny] = useState(false);
    const [showConfirmApprove, setShowConfirmApprove] = useState(false);
    const [requesterName, setRequesterName] = useState<string | null>(null);
    const [relatedSubevents, setRelatedSubevents] = useState<string[]>([]);

    useEffect(() => {
        if (show && refund && refund.stripePaymentIntent) {
            setLoadingStripe(true);
            setStripeDetails(null);
            api.get(`/api/stripe/retrieve?id=${refund.stripePaymentIntent}`, creds.pid, creds.hash)
                .then(data => setStripeDetails(data))
                .catch(err => {
                    console.error("Failed to fetch stripe details", err);
                    toast.error("Failed to fetch Stripe details");
                })
                .finally(() => setLoadingStripe(false));

            // Reset confirm states
            setShowConfirmDeny(false);
            setShowConfirmApprove(false);
        }
    }, [show, refund, creds]);

    // Fetch requester name
    useEffect(() => {
        if (show && refund && refund.requesterPid && creds) {
            setRequesterName(null);
            getTableItemOrNull('students', refund.requesterPid, creds.pid, creds.hash)
                .then(user => {
                    if (user) {
                        setRequesterName(`${user.first} ${user.last}`);
                    }
                })
                .catch(err => console.error("Failed to fetch requester details", err));
        }
    }, [show, refund?.requesterPid, creds]);

    // Fetch student and check for related subevents
    useEffect(() => {
        if (show && refund && refund.pid && refund.stripePaymentIntent && creds) {
            setRelatedSubevents([]);
            getTableItemOrNull('students', refund.pid, creds.pid, creds.hash)
                .then(student => {
                    if (student && student.programs) {
                        const related: string[] = [];
                        const intent = refund.stripePaymentIntent;

                        Object.entries(student.programs).forEach(([progId, progData]: [string, any]) => {
                            if (progData.offeringHistory) {
                                Object.entries(progData.offeringHistory).forEach(([subId, subData]: [string, any]) => {
                                    // Skip the current offering/subevent
                                    if (progId === refund.eventCode && subId === refund.subEvent) return;

                                    let match = false;
                                    if (subData.offeringIntent === intent) match = true;

                                    if (!match && subData.installments) {
                                        Object.values(subData.installments).forEach((inst: any) => {
                                            if (inst.offeringIntent === intent) match = true;
                                        });
                                    }

                                    if (match) {
                                        // We don't have eventsData easily available here for full names unless we fetch ALL events.
                                        // For now, use IDs or basic formatting.
                                        // If we want names, we'd need to fetch event definitions. 
                                        // Given this is an admin/approval view, IDs might be acceptable or "eventCode - subEvent".
                                        // Let's rely on IDs and standard formatting.
                                        const sName = ['event', 'retreat'].includes(subId.toLowerCase()) ? '' : subId;
                                        related.push(sName ? `${progId} - ${sName}` : progId);
                                    }
                                });
                            }
                        });
                        setRelatedSubevents(Array.from(new Set(related)));
                    }
                })
                .catch(err => console.error("Failed to fetch student details for series check", err));
        }
    }, [show, refund, creds]);

    const handleProcess = async (action: 'APPROVE' | 'DENY') => {
        setProcessing(true);
        try {
            await api.post('/api/refunds/process', creds.pid, creds.hash, {
                stripePaymentIntent: refund.stripePaymentIntent,
                action
            });
            toast.success(`Refund ${action === 'APPROVE' ? 'Approved' : 'Denied'} Successfully`);
            onComplete();
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || `Failed to ${action} refund`);
        } finally {
            setProcessing(false);
        }
    };

    if (!refund) return null;

    return (
        <Modal show={show} onHide={onHide} size="lg" centered>
            <Modal.Header closeButton className="bg-dark text-white border-secondary">
                <Modal.Title>Process Refund Request</Modal.Title>
            </Modal.Header>
            <Modal.Body className="bg-dark text-white">
                <div className="mb-3">
                    <p><strong>Date:</strong> {new Date(refund.createdAt).toLocaleString()}</p>
                    <p><strong>Event:</strong> {refund.eventName || refund.eventCode}</p>
                    {['event', 'retreat'].includes(refund.subEvent?.toLowerCase()) ? null : (
                        <p><strong>SubEvent:</strong> {refund.subEvent}</p>
                    )}
                    <p><strong>Student:</strong> {refund.studentName || refund.pid}</p>
                    <p><strong>Reason:</strong> {refund.reason}</p>
                    <p><strong>Requested By:</strong> {requesterName || refund.requesterName || refund.requesterPid || 'Unknown'}</p>

                    {relatedSubevents.length > 0 && (
                        <div className="mt-3 p-2 border border-info rounded bg-info bg-opacity-10">
                            <strong>Related Subevents (Series):</strong>
                            <ul className="mb-0 ps-3 mt-1">
                                {relatedSubevents.map((rs, idx) => (
                                    <li key={idx} className="small">{rs}</li>
                                ))}
                            </ul>
                            <div className="text-muted small mt-1 fst-italic">
                                Approving this refund will also update the status of these related events.
                            </div>
                        </div>
                    )}
                </div>

                <hr className="border-secondary" />

                <h5 className="mb-3">Stripe Details</h5>
                {loadingStripe ? (
                    <div className="text-center text-info"><Spinner animation="border" size="sm" /> Loading Stripe Data...</div>
                ) : stripeDetails ? (
                    <div className="p-3 border border-secondary rounded bg-secondary bg-opacity-10">
                        <div className="mb-2">
                            <strong>Total Transaction Amount:</strong> <span className="text-white me-2">${(stripeDetails.amount / 100).toFixed(2)}</span>
                            {stripeDetails.currency.toUpperCase()}
                        </div>

                        <hr className="border-secondary" />

                        <div className="mb-2">
                            <strong>Refund Requested:</strong> <span className="text-success fs-4 me-2">
                                ${refund.refundAmount ? (refund.refundAmount / 100).toFixed(2) : (stripeDetails.amount / 100).toFixed(2)}
                            </span>
                            {stripeDetails.currency.toUpperCase()}
                            {refund.refundAmount && refund.refundAmount < stripeDetails.amount && (
                                <Badge bg="info" className="ms-2">Partial Refund</Badge>
                            )}
                        </div>

                        {stripeDetails.description && (
                            <div className="mb-2"><strong>Description:</strong> {stripeDetails.description}</div>
                        )}
                        {stripeDetails.payment_method && stripeDetails.payment_method.card && (
                            <div className="mb-2">
                                <strong>Card:</strong> {stripeDetails.payment_method.card.brand?.toUpperCase()} •••• {stripeDetails.payment_method.card.last4}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-warning">Could not load Stripe details</div>
                )}

                {/* Confirmation Modals/Overlays logic within this body or separate modal?
                    User requirement: "If Deny is pressed a 'Are you sure you want to deny this refund?' question is displayed... dismiss the approve/deny modal."
                    I'll use a simple conditional rendering here effectively replacing the body or using standard JS confirm?
                    User said "question is displayed". Standard modal or inline?
                    "If the answer is yes, then set... and dismiss the approve/deny modal".
                    Let's use standard window.confirm for simplicity, OR better, a nested state in the UI since window.confirm is ugly.
                    I added states `showConfirmDeny`.
                */}

                {showConfirmDeny && (
                    <div className="alert alert-danger mt-3">
                        <p>Are you sure you want to <strong>DENY</strong> this refund?</p>
                        <div className="d-flex justify-content-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setShowConfirmDeny(false)}>No</Button>
                            <Button variant="danger" size="sm" onClick={() => handleProcess('DENY')} disabled={processing}>{processing ? 'Processing...' : 'Yes, Deny'}</Button>
                        </div>
                    </div>
                )}

                {showConfirmApprove && (
                    <div className="alert alert-success mt-3">
                        <p>Are you sure you want to <strong>APPROVE</strong> this refund?</p>
                        <div className="d-flex justify-content-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setShowConfirmApprove(false)}>No</Button>
                            <Button variant="success" size="sm" onClick={() => handleProcess('APPROVE')} disabled={processing}>{processing ? 'Processing...' : 'Yes, Approve'}</Button>
                        </div>
                    </div>
                )}

            </Modal.Body>
            <Modal.Footer className="bg-dark border-secondary">
                {!showConfirmDeny && !showConfirmApprove && refund.approvalState === 'PENDING' && (
                    <>
                        <Button variant="danger" onClick={() => setShowConfirmDeny(true)}>Deny</Button>
                        <Button variant="success" onClick={() => setShowConfirmApprove(true)}>Approve</Button>
                    </>
                )}
                <Button variant="secondary" onClick={onHide}>Close</Button>
            </Modal.Footer>
        </Modal>
    );
};

export default ApprovalModal;
