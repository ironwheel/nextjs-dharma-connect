import React, { useState, useMemo } from 'react';
import { Table, Button, Form } from 'react-bootstrap';
import { VersionBadge } from 'sharedFrontend';

export interface Column {
    field: string;
    headerName?: string;
    sortable?: boolean;
    width?: number;
    cellRenderer?: string;
    editable?: boolean;
    hide?: boolean;
    pinned?: 'left' | 'right';
    writeEnabled?: boolean; // Added for new logic
    render?: (row: any) => React.ReactNode;
    valueGetter?: (row: any) => any;
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

    canRefreshCache?: boolean;
    onRefreshCache?: () => void;
    pid?: string;
    hash?: string;
    recordCountLabel?: string;
    onRowClick?: (row: any) => void;
    defaultSortField?: string;
    defaultSortDirection?: 'asc' | 'desc';
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

    canRefreshCache,
    onRefreshCache,
    pid,
    recordCountLabel,
    onRowClick,
    defaultSortField = 'timestamp',
    defaultSortDirection = 'desc'
}) => {
    // Default sort by Date (timestamp) descending
    const [sortConfig, setSortConfig] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: defaultSortField, direction: defaultSortDirection });

    const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    // Update sort config if columns change and current sort field is invalid, though standard behavior is keep state
    // Effect to set default if initial logic missed or columns loaded late
    React.useEffect(() => {
        if (!columns.some(c => c.field === sortConfig.field) && columns.length > 0) {
            const firstSortable = columns.find(c => c.sortable);
            if (firstSortable) setSortConfig({ field: firstSortable.field, direction: 'asc' });
        }
    }, [columns]);


    // Filter out hidden columns
    const visibleColumns = useMemo(() => {
        const filtered = columns.filter(col => !col.hide);
        return filtered;
    }, [columns]);

    // Sort data
    const sortedData = useMemo(() => {
        const sortCol = columns.find(c => c.field === sortConfig.field);

        return [...data].sort((a, b) => {
            let aValue;
            let bValue;

            if (sortCol?.valueGetter) {
                aValue = sortCol.valueGetter(a);
                bValue = sortCol.valueGetter(b);
            } else {
                aValue = a[sortConfig.field];
                bValue = b[sortConfig.field];
            }

            if (aValue === bValue) return 0;
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            const comparison = aValue < bValue ? -1 : 1;
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [data, sortConfig, columns]);

    // Handle column sorting
    const handleSort = (field: string) => {
        setSortConfig(current => {
            if (current.field === field) {
                return current.direction === 'asc'
                    ? { field, direction: 'desc' } // Correctly toggle to desc
                    : { field, direction: 'asc' }; // Correctly toggle to asc
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

    // Render sort arrow
    const renderSortArrow = (field: string) => {
        if (sortConfig.field === field) {
            return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
        }
        return null;
    };

    // Render cell content
    const renderCell = (row: any, col: Column, rowIndex: number) => {
        // Custom render function
        if (col.render) {
            return col.render(row);
        }

        const value = row[col.field];
        const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.field === col.field;

        // Index column - handle any field that represents row index
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
                            // Pass the student ID instead of row index
                            const studentId = row.id;
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

        // Clickable cell for name/email/owyaa
        if (col.field === 'name' || col.field === 'email' || col.field === 'owyaa') {
            if (col.field === 'name') {
                if (canViewStudentHistory === true) {
                    return (
                        <span
                            className="text-primary cursor-pointer"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleCellClick(col.field, row)}
                        >
                            {value}
                        </span>
                    );
                } else {
                    return (
                        <span
                            style={{ color: 'black', cursor: 'default' }}
                        >
                            {value}
                        </span>
                    );
                }
            }
            // For email/owyaa, keep existing logic
            return (
                <span
                    className="text-primary cursor-pointer"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleCellClick(col.field, row)}
                >
                    {value}
                </span>
            );
        }

        // Default cell
        return value?.toString() || '';
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner-border text-light" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
                <div className="mt-3 text-light">Loading data...</div>
            </div>
        );
    }

    // Helper for column style
    const getColumnStyle = (col: Column) => {
        const isNumeric = ['amount', 'fee', 'kmFee', 'net', 'Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.field) ||
            (col.headerName && ['Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.headerName));

        return {
            textAlign: isNumeric ? 'right' as const : 'left' as const
        };
    };

    return (
        <div className="data-table-container">
            {/* Status bar removed */}

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
                                        <div className={`d-flex align-items-center ${['amount', 'fee', 'kmFee', 'net', 'Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.field) || (col.headerName && ['Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.headerName)) ? 'justify-content-end' : ''}`}>
                                            <span onClick={() => handleSort(col.field)} className="sortable-header">
                                                {col.headerName || col.field}
                                                {renderSortArrow(col.field)}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>

                        </thead>
                        <tbody>
                            {sortedData?.map((row, rowIndex) => (
                                <tr
                                    key={row.transaction || row.id || rowIndex}
                                    onClick={() => onRowClick && onRowClick(row)}
                                    style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                                >
                                    {visibleColumns.map((col, colIndex) => (
                                        <td
                                            key={col.field}
                                            style={{
                                                width: col.width,
                                                cursor: col.editable ? 'pointer' : 'default',
                                                ...getColumnStyle(col)
                                            }}
                                            onDoubleClick={() => col.editable && handleCellEdit(rowIndex, col.field, row[col.field])}
                                        >
                                            {renderCell(row, col, rowIndex)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            </div>
        </div>
    );
}; 