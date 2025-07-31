import React, { useState, useMemo } from 'react';
import { Table, Button, Form } from 'react-bootstrap';



export interface Column {
    field: string;
    headerName?: string;
    sortable?: boolean;
    width?: number;
    cellRenderer?: string;
    editable?: boolean;
    hide?: boolean;
    pinned?: 'left' | 'right';
    writeEnabled?: boolean;
}

export interface DataTableProps {
    data: any[];
    columns: Column[];
    onCellValueChanged?: (field: string, rowIndex: number, value: any) => void;
    onCellClicked?: (field: string, rowData: any) => void;
    onCheckboxChanged?: (field: string, studentId: string, checked: boolean) => void;
    onCSVExport?: () => void;
    loading?: boolean;
    websocketStatus?: string;
    connectionId?: string;
    studentUpdateCount?: number;
    itemCount?: number;
    canWriteViews?: boolean;
    canExportCSV?: boolean;
    canViewStudentHistory?: boolean;
    currentUserName?: string;
    version?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
    data,
    columns,
    onCellValueChanged,
    onCellClicked,
    onCheckboxChanged,
    onCSVExport,
    loading = false,
    websocketStatus,
    connectionId,
    studentUpdateCount,
    itemCount,
    canWriteViews,
    canExportCSV,
    canViewStudentHistory,
    currentUserName,
    version
}) => {
    const [sortConfig, setSortConfig] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: 'studentName', direction: 'asc' });
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    // Filter out hidden columns
    const visibleColumns = useMemo(() => {
        const filtered = columns.filter(col => !col.hide);
        return filtered;
    }, [columns]);

    // Sort data
    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => {
            const aValue = a[sortConfig.field];
            const bValue = b[sortConfig.field];

            if (aValue === bValue) return 0;
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            const comparison = aValue < bValue ? -1 : 1;
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [data, sortConfig]);

    // Handle column sorting
    const handleSort = (field: string) => {
        setSortConfig(current => {
            if (current.field === field) {
                return current.direction === 'asc'
                    ? { field, direction: 'desc' }
                    : { field, direction: 'asc' };
            }
            return { field, direction: 'asc' };
        });
    };

    // Handle cell editing
    const handleCellEdit = (rowIndex: number, field: string, value: any) => {
        const col = columns.find(c => c.field === field);
        if (!canWriteViews || !col?.writeEnabled) return;
        setEditingCell({ rowIndex, field });
        setEditValue(value?.toString() || '');
    };

    const handleCellSave = () => {
        if (editingCell && onCellValueChanged) {
            onCellValueChanged(editingCell.field, editingCell.rowIndex, editValue);
        }
        setEditingCell(null);
        setEditValue('');
    };

    const handleCellCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };

    // Handle cell clicks
    const handleCellClick = (field: string, rowData: any) => {
        if (onCellClicked) {
            onCellClicked(field, rowData);
        }
    };

    // Render cell content
    const renderCell = (row: any, col: Column, rowIndex: number) => {
        const value = row[col.field];
        const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.field === col.field;
        const isUnsubscribed = row.isUnsubscribed || false;

        // Index column
        if (col.field === '#' || col.field === 'rowIndex' || col.headerName === '#' || col.field.toLowerCase().includes('index') || col.field.toLowerCase().includes('row')) {
            return rowIndex + 1;
        }

        // Checkbox renderer
        if (col.cellRenderer === 'checkboxRenderer') {
            const isWriteEnabled = canWriteViews && col.writeEnabled;
            return (
                <Form.Check
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => {
                        if (isWriteEnabled && onCheckboxChanged) {
                            const studentId = row.studentId;
                            if (studentId) {
                                onCheckboxChanged(col.field, studentId, e.target.checked);
                            }
                        }
                    }}
                    disabled={!isWriteEnabled || loading}
                    style={{ cursor: isWriteEnabled ? 'pointer' : 'default' }}
                />
            );
        }

        // Editable cell
        if (isEditing && col.editable && col.writeEnabled && canWriteViews) {
            return (
                <div className="d-flex">
                    <Form.Control
                        size="sm"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCellSave();
                            if (e.key === 'Escape') handleCellCancel();
                        }}
                        autoFocus
                    />
                    <Button size="sm" variant="success" className="ms-1" onClick={handleCellSave}>
                        ✓
                    </Button>
                    <Button size="sm" variant="secondary" className="ms-1" onClick={handleCellCancel}>
                        ✕
                    </Button>
                </div>
            );
        }

        // Clickable cell for student name
        if (col.field === 'studentName') {
            return (
                <span
                    className={`cursor-pointer ${isUnsubscribed ? 'text-muted' : 'text-primary'}`}
                    style={{
                        cursor: isUnsubscribed ? 'not-allowed' : 'pointer',
                        opacity: isUnsubscribed ? 0.6 : 1
                    }}
                    onClick={() => handleCellClick(col.field, row)}
                >
                    {value}
                </span>
            );
        }

        // Email and language columns - hide for unsubscribed students
        if (col.field === 'email' || col.field === 'language') {
            if (isUnsubscribed) {
                return <span className="text-muted">—</span>;
            }
            return value?.toString() || '';
        }

        // Clickable cell for permitted apps
        if (col.field === 'permittedApps') {
            if (value === 'None' || isUnsubscribed) {
                return <span className="text-muted">{value}</span>;
            }

            const appNames = value.split(', ').map((app: string) => app.trim());
            return (
                <div className="d-flex flex-wrap gap-1">
                    {appNames.map((appName: string, index: number) => {
                        // Skip registration app
                        if (appName.toLowerCase().includes('registration')) {
                            return <span key={index} className="text-muted">{appName}</span>;
                        }

                        return (
                            <span
                                key={index}
                                className="badge cursor-pointer"
                                style={{
                                    cursor: 'pointer',
                                    backgroundColor: '#000000',
                                    color: '#ffffff',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '4px 8px',
                                    borderRadius: '12px',
                                    fontSize: '0.875rem',
                                    lineHeight: '1',
                                    minHeight: '24px'
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    console.log('App button clicked:', appName, row);
                                    handleCellClick('permittedApp', { ...row, appName, appIndex: index });
                                }}
                            >
                                {appName}
                            </span>
                        );
                    })}
                </div>
            );
        }

        // Actions column
        if (col.field === 'actions') {
            return (
                <div className="d-flex gap-1">
                    <Button
                        size="sm"
                        variant="outline-warning"
                        onClick={() => handleCellClick('edit', row)}
                        disabled={isUnsubscribed}
                    >
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => handleCellClick('delete', row)}
                        disabled={row.studentId === 'default'}
                    >
                        Delete
                    </Button>
                </div>
            );
        }

        // Default cell
        return value?.toString() || '';
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner-border text-warning" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
                <div className="mt-3 text-light">Loading data...</div>
            </div>
        );
    }

    return (
        <div className="data-table-container">
            <div className="status-bar">
                <span className="status-item">
                    Records: {itemCount}
                </span>
                {currentUserName && (
                    <span className="status-item user-info">
                        {currentUserName}
                    </span>
                )}
                {version && (
                    <span className="status-item version-info">
                        Version: {version}
                    </span>
                )}
            </div>

            <div className="table-container">
                <div className="table-wrapper">
                    <Table striped bordered hover className="frozen-table ag-theme-alpine">
                        <thead>
                            <tr>
                                {visibleColumns.map((col, index) => (
                                    <th
                                        key={col.field}
                                        style={{
                                            width: col.width,
                                            cursor: col.sortable ? 'pointer' : 'default',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => col.sortable && handleSort(col.field)}
                                        className={col.sortable ? 'sortable-header' : ''}
                                    >
                                        <div className="d-flex align-items-center">
                                            {col.headerName || col.field}
                                            {col.sortable && sortConfig.field === col.field && (
                                                <span className="ms-1">
                                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.map((row, rowIndex) => {
                                const isUnsubscribed = row.isUnsubscribed || false;
                                return (
                                    <tr
                                        key={rowIndex}
                                        style={{
                                            opacity: isUnsubscribed ? 0.6 : 1,
                                            backgroundColor: isUnsubscribed ? 'rgba(0,0,0,0.05)' : undefined
                                        }}
                                    >
                                        {visibleColumns.map((col, colIndex) => (
                                            <td
                                                key={col.field}
                                                style={{
                                                    width: col.width,
                                                    cursor: col.editable ? 'pointer' : 'default'
                                                }}
                                                onDoubleClick={() => col.editable && handleCellEdit(rowIndex, col.field, row[col.field])}
                                            >
                                                {renderCell(row, col, rowIndex)}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </div>
            </div>
        </div>
    );
}; 