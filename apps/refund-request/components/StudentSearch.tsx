import React, { useState, useEffect } from 'react';
import { Form, ListGroup, Spinner } from 'react-bootstrap';
import { getAllTableItemsWithProjectionExpression } from 'sharedFrontend';
import { toast } from 'react-toastify';

interface StudentSearchProps {
    onSelect: (student: any) => void;
}

const StudentSearch: React.FC<StudentSearchProps> = ({ onSelect }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<any[]>([]);
    const [creds, setCreds] = useState<{ pid: string, hash: string } | null>(null);
    const studentsCache = React.useRef<any[] | null>(null);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
            setCreds({ pid, hash });
        }
    }, []);

    useEffect(() => {
        if (!searchTerm.trim() || !creds) {
            setResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setLoading(true);
            try {
                let students = studentsCache.current;

                if (!students) {
                    const projectionExpression = '#id, #first, #last, #email, #programs';
                    const expressionAttributeNames = {
                        '#id': 'id',
                        '#first': 'first',
                        '#last': 'last',
                        '#email': 'email',
                        '#programs': 'programs'
                    };

                    const fetchedStudents = await getAllTableItemsWithProjectionExpression(
                        'students',
                        creds.pid,
                        creds.hash,
                        projectionExpression,
                        expressionAttributeNames
                    );

                    if (Array.isArray(fetchedStudents)) {
                        studentsCache.current = fetchedStudents;
                        students = fetchedStudents;
                    }
                }

                if (Array.isArray(students)) {
                    const searchLower = searchTerm.toLowerCase();
                    const filtered = students.filter((s: any) => {
                        const fullName = `${s.first} ${s.last}`.toLowerCase();
                        return fullName.includes(searchLower) || (s.email && s.email.toLowerCase().includes(searchLower));
                    });
                    setResults(filtered.slice(0, 10));
                }
            } catch (err) {
                console.error(err);
                toast.error("Search failed");
            } finally {
                setLoading(false);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, creds]);

    return (
        <div>
            <Form.Group className="mb-3">
                <Form.Control
                    type="text"
                    placeholder="Search name or email..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    autoFocus
                />
            </Form.Group>
            <ListGroup className="mt-3">
                {loading ? (
                    <ListGroup.Item className="text-center text-muted">
                        <Spinner animation="border" size="sm" role="status" className="me-2" />
                        Searching...
                    </ListGroup.Item>
                ) : (
                    results.map(s => (
                        <ListGroup.Item
                            key={s.id}
                            action
                            onClick={() => onSelect(s)}
                        >
                            <div><strong>{s.first} {s.last}</strong></div>
                            <div className="text-muted small">{s.email}</div>
                        </ListGroup.Item>
                    ))
                )}
            </ListGroup>
        </div>
    );
};

export default StudentSearch;
