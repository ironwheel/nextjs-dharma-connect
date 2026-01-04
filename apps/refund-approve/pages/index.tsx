import React from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import RefundList from '../components/RefundList';

const RefundApprove: React.FC = () => {
    return (
        <Container fluid className="p-4 bg-dark text-white min-vh-100">
            <Row className="justify-content-center">
                <Col md={12}>
                    <h2 className="mb-4 text-center">Refund Approval Dashboard</h2>
                    <RefundList />
                </Col>
            </Row>
        </Container>
    );
};

export default RefundApprove;
