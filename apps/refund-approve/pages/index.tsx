import React, { useEffect, useState } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import RefundList from '../components/RefundList';
import { VersionBadge, getTableItem } from 'sharedFrontend';

const RefundApprove: React.FC = () => {
    const [creds, setCreds] = useState<{ pid: string, hash: string } | null>(null);
    const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
            setCreds({ pid, hash });
            // Fetch user name
            getTableItem('students', pid, pid, hash)
                .then((student: any) => {
                    if (student) {
                        setCurrentUserName(`${student.first} ${student.last}`);
                    }
                })
                .catch((err: any) => console.error('Error fetching user info', err));
        }
    }, []);

    return (
        <Container fluid className="p-4 bg-dark text-white min-vh-100">
            <Row className="justify-content-center">
                <Col md={12}>
                    <div className="d-flex align-items-center justify-content-center mb-4">
                        {currentUserName !== 'Unknown' && creds && (
                            <span className="status-item user-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                {currentUserName}
                            </span>
                        )}
                        {creds && (
                            <span className="status-item version-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                <VersionBadge pid={creds.pid} hash={creds.hash} />
                            </span>
                        )}
                        <h2 className="mb-0 text-center">Refund Approval Dashboard</h2>
                    </div>
                    <RefundList />
                </Col>
            </Row>
        </Container>
    );
};

export default RefundApprove;
