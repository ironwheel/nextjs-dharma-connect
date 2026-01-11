import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Navbar } from 'react-bootstrap';
import { useRouter } from 'next/router';
import Head from 'next/head';
import StudentSearch from '../components/StudentSearch';
import OfferingList from '../components/OfferingList';
import { VersionBadge, getTableItem } from 'sharedFrontend';

export default function Home() {
    const router = useRouter();
    const { pid, hash } = router.query;
    const [selectedStudent, setSelectedStudent] = useState<any>(null);
    const [authorized, setAuthorized] = useState(false);
    const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

    useEffect(() => {
        if (!router.isReady) return;

        if (!pid || !hash) {
            router.push('/login');
            return;
        }
        setAuthorized(true);

        // Fetch user name
        getTableItem('students', pid as string, pid as string, hash as string)
            .then((student: any) => {
                if (student) {
                    setCurrentUserName(`${student.first} ${student.last}`);
                }
            })
            .catch(err => console.error('Error fetching user info', err));

    }, [router.isReady, pid, hash, router]);

    if (!authorized) return null; // Or loading spinner

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#212529', color: 'white' }}>
            <Head>
                <title>Refund Request</title>
                <link rel="icon" href="/recycle.png" />
            </Head>
            <Navbar bg="dark" variant="dark" className="mb-4 border-bottom border-secondary">
                <Container>
                    <div className="d-flex align-items-center">
                        {currentUserName && (
                            <span className="status-item user-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                {currentUserName}
                            </span>
                        )}
                        {pid && hash && (
                            <span className="status-item version-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                <VersionBadge pid={pid as string} hash={hash as string} />
                            </span>
                        )}
                        <Navbar.Brand>Refund Requests</Navbar.Brand>
                    </div>
                </Container>
            </Navbar>
            <Container className="p-4">
                <Row>
                    <Col md={4}>
                        <Card className="mb-4 bg-dark text-white border-secondary">
                            <Card.Header className="border-secondary">Student Search</Card.Header>
                            <Card.Body>
                                <StudentSearch onSelect={setSelectedStudent} />
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={8}>
                        {selectedStudent ? (
                            <div className="text-white">
                                <OfferingList student={selectedStudent} />
                            </div>
                        ) : (
                            <div className="text-center text-muted p-5 bg-dark border border-secondary rounded">
                                Select a student to view offering history.
                            </div>
                        )}
                    </Col>
                </Row>
            </Container>
        </div>
    );
}
