import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faGlobe,
    faPlus,
    faMinus,
    faTimes,
    faPlusCircle,
    faMinusCircle,
    faUser,
    faCheck,
    faArrowLeft,
    faArrowUp,
    faArrowDown
} from "@fortawesome/free-solid-svg-icons";
import { toast } from 'react-toastify';
import {
    getTableItemOrNull,
    updateTableItem,
    getAllTableItems,
    putTableItem,
    TopNavBar,
    useLanguage,
    promptLookup,
    promptLookupHTMLWithArgs,
    checkEligibility
} from 'sharedFrontend';

interface MantraConfig {
    id: string;
    displayNamePrompt: string;
    descriptionPrompt?: string;
    bgColor: string;
    borderColor: string;
    displayOrder: number;
    isActive: boolean;
    incrementAmount: number;
    displayPool?: string;
    writeEnablePool?: string;
    group?: string;
    createdAt: string;
    updatedAt: string;
}

interface MantraCounts {
    [mantraId: string]: number;
}

interface GlobalMantraCounts {
    counts: { [mantraId: string]: number };
    distinctCountries: string[];
    count: number;
}

interface MantraCountProps {
    studentId: string;
    pid: string;
    hash: string;
    student: any; // Student object to access country and other fields
    onClose: () => void;
}

const MantraCount: React.FC<MantraCountProps> = ({ studentId, pid, hash, student, onClose }) => {
    const { currentLanguage } = useLanguage();

    // Personal counts (editable)
    const [personalCounts, setPersonalCounts] = useState<MantraCounts>({});

    // Shadow values for comparison
    const [shadowCounts, setShadowCounts] = useState<MantraCounts>({});

    // Original loaded values (for decrement limits)
    const [originalCounts, setOriginalCounts] = useState<MantraCounts>({});

    // Global counts (read-only)
    const [globalCounts, setGlobalCounts] = useState<GlobalMantraCounts>({
        counts: {},
        distinctCountries: [],
        count: 0
    });

    // Original global counts (for real-time updates)
    const [originalGlobalCounts, setOriginalGlobalCounts] = useState<{ [mantraId: string]: number }>({});

    // Mantra configurations
    const [mantraConfigs, setMantraConfigs] = useState<MantraConfig[]>([]);

    // Pools for eligibility checking
    const [pools, setPools] = useState<any[]>([]);

    // Loading states
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check if there are unsaved changes
    const hasUnsavedChanges = useCallback(() => {
        const activeMantraIds = mantraConfigs
            .filter(config => config.isActive)
            .map(config => config.id);

        return activeMantraIds.some(mantraId =>
            personalCounts[mantraId] !== shadowCounts[mantraId]
        );
    }, [personalCounts, shadowCounts, mantraConfigs]);

    // Format numbers with commas
    const formatNumber = (num: number): string => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };

    // Group mantra configs by their group field
    const groupMantraConfigs = (configs: MantraConfig[]): { [groupName: string]: MantraConfig[] } => {
        const groups: { [groupName: string]: MantraConfig[] } = {};

        configs.forEach(config => {
            const groupName = config.group || 'default';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(config);
        });

        // Sort configs within each group by displayOrder
        Object.keys(groups).forEach(groupName => {
            groups[groupName].sort((a, b) => a.displayOrder - b.displayOrder);
        });

        return groups;
    };

    // Check if a mantra is writable based on writeEnablePool
    const isMantraWritable = (config: MantraConfig): boolean => {
        // If no writeEnablePool specified, allow writing
        if (!config.writeEnablePool) return true;

        // If pools are not loaded yet, assume not writable
        if (pools.length === 0) return false;

        // Check eligibility for write access
        return checkEligibility(config.writeEnablePool, student, 'mantra-count', pools);
    };



    // Fetch personal mantra counts
    const fetchPersonalMantraCount = useCallback(async () => {
        try {
            const result = await getTableItemOrNull('mantra-count', studentId, pid, hash);

            if (result && typeof result === 'object' && 'redirected' in result) {
                setError('Authentication required');
                return;
            }

            if (result && result.counts) {
                setPersonalCounts(result.counts);
                setShadowCounts(result.counts); // Set shadow values
                setOriginalCounts(result.counts); // Set original values for decrement limits
            } else {
                // Create new record if none exists
                const initialCounts: MantraCounts = {};

                // Initialize counts for all active mantras
                mantraConfigs.forEach(config => {
                    initialCounts[config.id] = 0;
                });

                const newRecord = {
                    id: studentId,
                    counts: initialCounts,
                    country: student.country || 'Unknown',
                    lastUpdatedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                };

                try {
                    await putTableItem('mantra-count', studentId, newRecord, pid, hash);
                    console.log('Created new mantra count record for student:', studentId);
                } catch (createErr: any) {
                    console.error('Error creating new mantra count record:', createErr);
                    // Continue with local state even if creation fails
                }

                setPersonalCounts(initialCounts);
                setShadowCounts(initialCounts);
                setOriginalCounts(initialCounts); // Set original values for new records
            }
        } catch (err: any) {
            console.error('Error fetching personal mantra counts:', err);
            setError(promptLookup('mantraCountErrorLoadPersonal'));
        }
    }, [studentId, pid, hash, student.country, mantraConfigs]);

    // Fetch global mantra counts
    const getGlobalMantraCounts = useCallback(async () => {
        try {
            const result = await getAllTableItems('mantra-count', pid, hash);

            if (result && typeof result === 'object' && 'redirected' in result) {
                setError('Authentication required');
                return;
            }

            if (Array.isArray(result)) {
                const globalCounts: { [mantraId: string]: number } = {};
                const countries: string[] = [];

                // Initialize counts for all active mantras
                mantraConfigs.forEach(config => {
                    globalCounts[config.id] = 0;
                });

                result.forEach((item: any) => {
                    if (item.counts) {
                        // Sum up counts for each mantra
                        Object.keys(item.counts).forEach(mantraId => {
                            if (globalCounts.hasOwnProperty(mantraId)) {
                                globalCounts[mantraId] += item.counts[mantraId] || 0;
                            }
                        });
                    }

                    if (item.country) {
                        countries.push(item.country);
                    }
                });

                const distinctCountries = Array.from(new Set(countries)).sort();

                setGlobalCounts({
                    counts: globalCounts,
                    distinctCountries,
                    count: result.length
                });

                // Store original global counts for real-time updates
                setOriginalGlobalCounts(globalCounts);
            }
        } catch (err: any) {
            console.error('Error fetching global mantra counts:', err);
            setError(promptLookup('mantraCountErrorLoadGlobal'));
        }
    }, [pid, hash, mantraConfigs]);

    // Update personal mantra counts
    const updatePersonalMantraCount = useCallback(async () => {
        setIsSaving(true);
        try {
            const item = {
                id: studentId,
                counts: personalCounts,
                country: student.country || 'Unknown',
                lastUpdatedAt: new Date().toISOString()
            };

            const result = await updateTableItem('mantra-count', studentId, 'id', item, pid, hash);

            if (result && typeof result === 'object' && 'redirected' in result) {
                setError('Authentication required');
                return;
            }

            // Update shadow values after successful save
            setShadowCounts(personalCounts);

            // Reset global counts to original values since changes are now saved
            getGlobalMantraCounts();

            toast.success(promptLookup('mantraCountSaveSuccess'));
            onClose();
        } catch (err: any) {
            console.error('Error updating personal mantra counts:', err);
            setError(promptLookup('mantraCountErrorSave'));
            toast.error(promptLookup('mantraCountErrorSave'));
        } finally {
            setIsSaving(false);
        }
    }, [personalCounts, studentId, pid, hash, onClose]);

    // Handle count increment/decrement
    const handleCountChange = useCallback((mantraId: string, increment: number) => {
        setPersonalCounts(prev => {
            const newValue = (prev[mantraId] || 0) + increment;
            const originalValue = originalCounts[mantraId] || 0;

            // Prevent going below original loaded value
            if (increment < 0 && newValue < originalValue) {
                toast.error(promptLookup('mantraCountCannotDecrement').replace('{value}', originalValue.toString()));
                return prev;
            }

            return {
                ...prev,
                [mantraId]: newValue
            };
        });

        // Update global counts in real-time
        setGlobalCounts(prev => {
            const originalGlobalValue = originalGlobalCounts[mantraId] || 0;
            const originalPersonalValue = originalCounts[mantraId] || 0;
            const currentPersonalValue = personalCounts[mantraId] || 0;
            const newPersonalValue = currentPersonalValue + increment;

            // Calculate the difference between new personal and original personal value
            const personalDiff = newPersonalValue - originalPersonalValue;

            return {
                ...prev,
                counts: {
                    ...prev.counts,
                    [mantraId]: originalGlobalValue + personalDiff
                }
            };
        });
    }, [originalCounts, personalCounts, originalGlobalCounts]);

    // Load data on component mount
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // First load pools
                const poolsResult = await getAllTableItems('pools', pid, hash);
                if (poolsResult && typeof poolsResult === 'object' && 'redirected' in poolsResult) {
                    setError('Authentication required');
                    return;
                }
                const currentPools = Array.isArray(poolsResult) ? poolsResult : [];
                setPools(currentPools);

                // Then load mantra configs with eligibility checking
                const configResult = await getAllTableItems('mantra-config', pid, hash);
                if (configResult && typeof configResult === 'object' && 'redirected' in configResult) {
                    setError('Authentication required');
                    return;
                }

                if (Array.isArray(configResult)) {
                    // Filter active mantras, check eligibility, and sort by display order
                    const activeConfigs = configResult
                        .filter((config: MantraConfig) => {
                            // Check if mantra is active
                            if (!config.isActive) return false;

                            // Check eligibility if displayPool is specified
                            if (config.displayPool && currentPools.length > 0) {
                                return checkEligibility(config.displayPool, student, 'mantra-count', currentPools);
                            }

                            // If no displayPool specified, show the mantra
                            return true;
                        })
                        .sort((a: MantraConfig, b: MantraConfig) => a.displayOrder - b.displayOrder);

                    setMantraConfigs(activeConfigs);
                }
            } catch (err) {
                console.error('Error loading data:', err);
                setError('Failed to load data');
            } finally {
                setIsLoading(false);
            }
        };

        if (studentId) {
            loadData();
        }
    }, [studentId, pid, hash, student]);

    // Load personal and global counts after configs are loaded
    useEffect(() => {
        if (mantraConfigs.length > 0) {
            Promise.all([
                fetchPersonalMantraCount(),
                getGlobalMantraCounts()
            ]).catch(err => {
                console.error('Error loading mantra data:', err);
                setError('Failed to load mantra data');
            });
        }
    }, [mantraConfigs, fetchPersonalMantraCount, getGlobalMantraCounts]);

    // Handle unsaved changes warning
    const handleClose = useCallback(() => {
        if (hasUnsavedChanges()) {
            if (window.confirm(promptLookup('mantraCountUnsavedChangesConfirm'))) {
                setPersonalCounts(shadowCounts);
                onClose();
            }
        } else {
            onClose();
        }
    }, [hasUnsavedChanges, shadowCounts, onClose, currentLanguage]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 text-white">
                <TopNavBar title={promptLookup('title')} />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-center min-h-[calc(100vh-120px)]">
                    <div className="text-white text-xl">{promptLookup('mantraCountLoading')}</div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-900 text-white">
                <TopNavBar title={promptLookup('title')} />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-center min-h-[calc(100vh-120px)]">
                    <div className="text-red-400 text-xl">{error}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white">
            {/* Ensure Tailwind includes color classes */}
            <div className="hidden bg-blue-600 bg-green-600 bg-purple-600 bg-red-600 bg-orange-600 border-blue-500 border-green-500 border-purple-500 border-red-500 border-orange-500"></div>
            <TopNavBar title={promptLookup('controlTitleMantraCounter')} />
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <p className="text-gray-300 mb-2">
                        <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs('mantraCountCommunity', formatNumber(globalCounts.count), '')} />
                    </p>
                    <p className="text-gray-400 text-sm">
                        {globalCounts.distinctCountries.join(', ')}
                    </p>
                </div>

                {/* Mantra Groups */}
                <div className="space-y-8 mb-8">
                    {Object.entries(groupMantraConfigs(mantraConfigs)).map(([groupName, groupConfigs]) => (
                        <div key={groupName} className="border-2 border-gray-600 rounded-lg p-6">
                            {/* Group Description */}
                            {groupName !== 'default' && (
                                <div className="mb-6 text-center">
                                    <h2 className="text-xl font-bold text-white mb-2">
                                        <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(`mantraCountGroupTitle-${groupName}`, '', '')} />
                                    </h2>
                                    <div dangerouslySetInnerHTML={promptLookupHTMLWithArgs(`mantraCountGroupDescription-${groupName}`, '', '')} />
                                </div>
                            )}

                            {/* Mantra Cards Grid for this group */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                                {groupConfigs.map((config) => (
                                    <div key={config.id} className={`${config.bgColor || 'bg-gray-800'} rounded-lg border-2 ${config.borderColor || 'border-gray-600'} p-4 flex flex-col h-64`}>
                                        {/* Title - Fixed height to ensure alignment */}
                                        <h3 className="font-bold text-lg mb-4 text-center min-h-[4rem] flex items-center justify-center leading-tight">
                                            {promptLookup(config.displayNamePrompt)}
                                        </h3>

                                        {/* Personal Count */}
                                        <div className="text-center mb-3">
                                            <div className="flex items-center justify-center">
                                                <FontAwesomeIcon icon={faUser} className="mr-2 text-lg" />
                                                <div className="text-2xl font-bold">
                                                    {formatNumber(personalCounts[config.id] || 0)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Global Count */}
                                        <div className="text-center mb-4">
                                            <div className="flex items-center justify-center">
                                                <FontAwesomeIcon icon={faGlobe} className="mr-2 text-lg" />
                                                <div className="text-2xl font-bold">
                                                    {formatNumber(globalCounts.counts[config.id] || 0)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Controls */}
                                        <div className="flex justify-between items-center mt-auto">
                                            <button
                                                onClick={() => handleCountChange(config.id, -config.incrementAmount)}
                                                disabled={!isMantraWritable(config)}
                                                className={`rounded-full w-10 h-10 flex items-center justify-center transition-colors border ${isMantraWritable(config)
                                                    ? 'bg-white/20 hover:bg-white/30 text-white border-white/30'
                                                    : 'bg-gray-600 text-gray-400 border-gray-500 cursor-not-allowed'
                                                    }`}
                                                title={isMantraWritable(config) ? `Subtract ${config.incrementAmount}` : 'Write access not available'}
                                            >
                                                <FontAwesomeIcon icon={faArrowDown} />
                                            </button>

                                            <button
                                                onClick={() => handleCountChange(config.id, config.incrementAmount)}
                                                disabled={!isMantraWritable(config)}
                                                className={`rounded-full w-10 h-10 flex items-center justify-center transition-colors border ${isMantraWritable(config)
                                                    ? 'bg-white/20 hover:bg-white/30 text-white border-white/30'
                                                    : 'bg-gray-600 text-gray-400 border-gray-500 cursor-not-allowed'
                                                    }`}
                                                title={isMantraWritable(config) ? `Add ${config.incrementAmount}` : 'Write access not available'}
                                            >
                                                <FontAwesomeIcon icon={faArrowUp} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-between items-center">
                    <button
                        onClick={handleClose}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg flex items-center transition-colors"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} className="mr-2" />
                        {promptLookup('mantraCountBackToDashboard')}
                    </button>

                    {hasUnsavedChanges() && (
                        <button
                            onClick={updatePersonalMantraCount}
                            disabled={isSaving}
                            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white px-6 py-3 rounded-lg flex items-center transition-colors"
                        >
                            <FontAwesomeIcon icon={faCheck} className="mr-2" />
                            {isSaving ? promptLookup('mantraCountSaving') : promptLookup('mantraCountSaveAndExit')}
                        </button>
                    )}
                </div>

                {/* Unsaved Changes Indicator */}
                {hasUnsavedChanges() && (
                    <div className="mt-4 p-3 bg-yellow-600 bg-opacity-20 border border-yellow-500 rounded-lg">
                        <p className="text-yellow-300 text-sm">
                            {promptLookup('mantraCountUnsavedChanges')}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MantraCount; 