import React, { useState } from 'react';
import { ALL_INCONFORMITY_OPTIONS, dropdownFields } from '../../utils/constants';

export interface FilterState {
    startDate: string;
    endDate: string;
    inconformities: string[];
    studio: string;
}

interface FilterControlsProps {
    activeFilters: FilterState;
    onFiltersChange: (filters: FilterState) => void;
    onClose: () => void;
}

const FilterControls: React.FC<FilterControlsProps> = ({ activeFilters, onFiltersChange, onClose }) => {
    const [localFilters, setLocalFilters] = useState<FilterState>(activeFilters);
    const studioOptions = dropdownFields['STUDIO'] || [];

    const handleFieldChange = (field: 'startDate' | 'endDate' | 'studio', value: string) => {
        setLocalFilters(prev => ({ ...prev, [field]: value }));
    };

    const handleInconformityChange = (inconformity: string, checked: boolean) => {
        setLocalFilters(prev => {
            const newInconformities = checked
                ? [...prev.inconformities, inconformity]
                : prev.inconformities.filter(item => item !== inconformity);
            return { ...prev, inconformities: newInconformities };
        });
    };

    const handleApply = () => {
        onFiltersChange(localFilters);
        onClose();
    };

    const handleClear = () => {
        const clearedFilters: FilterState = { startDate: '', endDate: '', inconformities: [], studio: '' };
        setLocalFilters(clearedFilters);
        onFiltersChange(clearedFilters);
    };

    const getFormattedDate = (daysAgo: number) => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date.toISOString().split('T')[0];
    };

    const setDateRange = (startDaysAgo: number, endDaysAgo: number) => {
        setLocalFilters(prev => ({
            ...prev,
            startDate: getFormattedDate(startDaysAgo),
            endDate: getFormattedDate(endDaysAgo),
        }));
    };
    
    const activeFilterCount = (localFilters.startDate && localFilters.endDate ? 1 : 0) + localFilters.inconformities.length + (localFilters.studio ? 1 : 0);


    return (
        <div className="p-4 bg-solar-light-content dark:bg-solar-dark-content rounded-lg w-96 flex flex-col gap-4">
            <div>
                <h3 className="text-xs font-bold uppercase text-white mb-2">Filter by Date</h3>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-gray-300" htmlFor="start-date">From</label>
                        <input
                            id="start-date"
                            type="date"
                            value={localFilters.startDate}
                            onChange={(e) => handleFieldChange('startDate', e.target.value)}
                            className="w-full mt-1 bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-white dark:[color-scheme:dark]"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-300" htmlFor="end-date">To</label>
                        <input
                            id="end-date"
                            type="date"
                            value={localFilters.endDate}
                            onChange={(e) => handleFieldChange('endDate', e.target.value)}
                            className="w-full mt-1 bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-white dark:[color-scheme:dark]"
                        />
                    </div>
                </div>
                <div className="flex gap-1 mt-2">
                    <button onClick={() => setDateRange(0, 0)} className="text-xs text-gray-300 px-2 py-1 rounded hover:bg-gray-500/10 hover:text-white">Today</button>
                    <button onClick={() => setDateRange(7, 0)} className="text-xs text-gray-300 px-2 py-1 rounded hover:bg-gray-500/10 hover:text-white">Last 7 days</button>
                    <button onClick={() => setDateRange(30, 0)} className="text-xs text-gray-300 px-2 py-1 rounded hover:bg-gray-500/10 hover:text-white">Last 30 days</button>
                </div>
            </div>

            <div>
                <h3 className="text-xs font-bold uppercase text-white mb-2">Filter by Studio</h3>
                 <select
                    id="studio-filter"
                    value={localFilters.studio}
                    onChange={(e) => handleFieldChange('studio', e.target.value)}
                    className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-white"
                >
                    <option value="">All Studios</option>
                    {studioOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
            </div>

            <div>
                <h3 className="text-xs font-bold uppercase text-white mb-2">Filter by Non-Conformity</h3>
                <div className="max-h-40 overflow-y-auto pr-2 space-y-1">
                    {ALL_INCONFORMITY_OPTIONS.map(option => (
                        <label key={option} className="flex items-center space-x-2 text-sm text-gray-200 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={localFilters.inconformities.includes(option)}
                                onChange={(e) => handleInconformityChange(option, e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-solar-accent focus:ring-solar-accent bg-transparent"
                            />
                            <span>{option}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-solar-dark-border">
                <button onClick={handleClear} className="text-sm text-gray-400 hover:text-white">
                    Clear Filters
                </button>
                <button onClick={handleApply} className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors flex items-center gap-2">
                    Apply {activeFilterCount > 0 && <span className="bg-white/20 text-xs rounded-full px-2 py-0.5">{activeFilterCount}</span>}
                </button>
            </div>
        </div>
    );
};

export default FilterControls;