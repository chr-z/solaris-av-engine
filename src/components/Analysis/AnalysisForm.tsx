import React, { useState } from 'react';
import { LinkIcon, GoogleDriveIcon, VideoIcon, InfoIcon } from '../Core/icons';
import { RowData } from '../../types';
import { formSections, allBooleanFields, dropdownFields, resultFields, simNaoFields } from '../../utils/constants';
import { DRIVE_FOLDER_REGEX } from '../../utils/regex';
import Tooltip from '../Core/Tooltip';
import { inconformityDetailsMap } from '../../utils/inconformityDetails';

interface AnalysisFormProps {
    selectedRow: RowData | null;
    headers: string[];
    onDataChange: (columnIndex: number, value: string) => void;
    onOpenPicker: (folderId: string) => void;
    isLocalVideo: boolean;
    localFilePath: string;
    onLocalFilePathChange: (path: string) => void;
}

const AnalysisForm: React.FC<AnalysisFormProps> = ({ 
    selectedRow, 
    headers, 
    onDataChange, 
    onOpenPicker,
    isLocalVideo,
    localFilePath,
    onLocalFilePathChange
}) => {
    const [activeTab, setActiveTab] = useState(Object.keys(formSections)[0]);

    if (!selectedRow) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500 p-4 text-center">
                <p>Select a Work Order from the list to view details and start grading.</p>
            </div>
        );
    }
    
    const activeFieldNames = formSections[activeTab] || [];
    // Disable inputs for calculated score fields
    const calculatedFields = new Set([...resultFields, 'FINAL SCORE']);

    const localVideoPathComponent = (
        <div className="p-6 pt-4 border-b border-solar-dark-border bg-solar-dark-bg/30">
            <label htmlFor="local-video-path" className="flex items-center gap-2 text-xs font-medium text-gray-300 mb-1">
                <VideoIcon className="w-4 h-4 text-solar-accent"/>
                Network Video Path (Optional)
            </label>
            <input
                id="local-video-path"
                type="text"
                value={localFilePath}
                onChange={(e) => onLocalFilePathChange(e.target.value)}
                placeholder="\\server\share\video.mp4"
                className="w-full bg-solar-dark-bg border border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200"
            />
             <p className="text-xs text-gray-500 mt-1">Paste the network path to help other analysts locate the raw file.</p>
        </div>
    );

    return (
        <div className="flex flex-col h-full">
            {/* Tab Navigation Bar */}
            <div className="flex-shrink-0 border-b border-solar-light-border dark:border-solar-dark-border sticky top-0 bg-solar-light-content dark:bg-solar-dark-content z-10">
                <nav className="-mb-px flex space-x-2 overflow-x-auto px-4" aria-label="Tabs">
                    {Object.keys(formSections).map(sectionTitle => (
                        <button
                            key={sectionTitle}
                            onClick={() => setActiveTab(sectionTitle)}
                            className={`whitespace-nowrap py-3 px-3 border-b-2 font-medium text-sm transition-colors
                                ${activeTab === sectionTitle
                                    ? 'border-solar-accent text-solar-accent'
                                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
                                }`}
                        >
                            {sectionTitle}
                        </button>
                    ))}
                </nav>
            </div>

            {isLocalVideo && localVideoPathComponent}

            {/* Tab Content Panel */}
            <div className="p-6 overflow-y-auto">
                 <div className="space-y-4">
                    {activeFieldNames.map(fieldName => {
                        const colIndex = headers.indexOf(fieldName);
                        if (colIndex === -1) return null;
                        
                        const cellData = selectedRow[colIndex];
                        const value = cellData?.value;
                        const isCalculatedField = calculatedFields.has(fieldName);

                        const label = (
                            <label htmlFor={fieldName} className="block text-xs font-medium text-gray-400 mb-1">
                                {cellData?.link ? (
                                    <a 
                                        href={cellData.link} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="inline-flex items-center gap-1.5 hover:text-solar-accent hover:underline"
                                    >
                                        {fieldName}
                                        <LinkIcon className='w-3 h-3 text-solar-accent' />
                                    </a>
                                ) : (
                                    fieldName
                                )}
                            </label>
                        );

                        // 1. Calculated Score Fields
                        if (isCalculatedField) {
                             return (
                                <div key={fieldName}>
                                    {label}
                                    <input
                                        id={fieldName}
                                        type="text"
                                        value={value?.toString() ?? '0.00'}
                                        readOnly
                                        className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-3 py-1.5 text-sm font-bold text-gray-300 focus:outline-none cursor-default"
                                    />
                                </div>
                            );
                        }
                        
                        const isSimNaoField = simNaoFields.has(fieldName);
                        const isBooleanField = allBooleanFields.has(fieldName);
                        const isCheckbox = isSimNaoField || isBooleanField;

                        // 2. Checkboxes (Checklist items)
                        if (isCheckbox) {
                            const details = inconformityDetailsMap[fieldName];
                            // Translate logic: YES/NO or TRUE/FALSE based on field type
                            const isChecked = isSimNaoField ? value === 'YES' : value === 'TRUE';
                            const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                                const newValue = isSimNaoField 
                                    ? (e.target.checked ? 'YES' : 'NO') 
                                    : (e.target.checked ? 'TRUE' : 'FALSE');
                                onDataChange(colIndex, newValue);
                            };
                    
                            return (
                                <label key={fieldName} className="flex items-center space-x-2.5 whitespace-nowrap pt-2 cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        id={fieldName}
                                        checked={isChecked}
                                        onChange={onChange}
                                        className="h-4 w-4 rounded border-gray-500 text-solar-accent focus:ring-solar-accent bg-transparent"
                                    />
                                    <span className="text-sm select-none flex items-center gap-1.5">
                                        {cellData?.link ? (
                                            <a 
                                                href={cellData.link} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                className="inline-flex items-center gap-1.5 hover:text-solar-accent hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {fieldName}
                                                <LinkIcon className='w-3 h-3 text-solar-accent' />
                                            </a>
                                        ) : (
                                            fieldName
                                        )}
                                        {details && (
                                            <Tooltip
                                                content={
                                                    <div className="space-y-2 text-left">
                                                        <p><strong className="font-bold text-white">Definition:</strong> <span className="text-gray-400 whitespace-pre-wrap">{details.definition}</span></p>
                                                        <p><strong className="font-bold text-white">Action:</strong> <span className="text-gray-400 whitespace-pre-wrap">{details.analystAction}</span></p>
                                                        <p><strong className="font-bold text-white">Impact:</strong> <span className="text-gray-400">{details.grade}</span></p>
                                                        <p><strong className="font-bold text-white">Penalty:</strong> <span className="text-gray-400">{details.score2025}</span></p>
                                                    </div>
                                                }
                                            >
                                                <InfoIcon className="w-4 h-4 text-gray-500 cursor-help" />
                                            </Tooltip>
                                        )}
                                    </span>
                                </label>
                            );
                        }
                        
                        // 3. Other Fields (Dropdowns & Text)
                        
                        // Special 'FOLDER' field with Drive Button
                        if (fieldName === 'FOLDER') {
                            const link = cellData?.link;
                            const match = link ? link.match(DRIVE_FOLDER_REGEX) : null;
                            const folderId = match ? match[1] : null;

                            return (
                                <div key={fieldName}>
                                    {label}
                                    <div className="relative">
                                        <input
                                            id={fieldName}
                                            value={value?.toString() ?? ''}
                                            readOnly
                                            className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent pr-10 cursor-default dark:text-gray-200"
                                        />
                                        <button
                                            onClick={() => folderId && onOpenPicker(folderId)}
                                            disabled={!folderId}
                                            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-solar-accent disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                                            title="Open Drive Folder"
                                            aria-label="Open Google Drive Picker"
                                        >
                                            <GoogleDriveIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                        
                        // Dropdown fields
                        const dropdownOptions = dropdownFields[fieldName];
                        if (dropdownOptions) {
                            return (
                                <div key={fieldName}>
                                    {label}
                                    <select
                                        id={fieldName}
                                        value={value?.toString() ?? ''}
                                        onChange={(e) => onDataChange(colIndex, e.target.value)}
                                        className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200"
                                    >
                                        <option value="" disabled={!!value}>Select...</option>
                                        {dropdownOptions.map(option => (
                                            <option key={option} value={option}>{option}</option>
                                        ))}
                                    </select>
                                </div>
                            );
                        }
                        
                        // Text/Textarea fields
                        // Checking for known long-text fields
                        const isTextarea = ['OPERATOR COMMENTS', 'INTERNAL NOTES', 'TECHNICAL FEEDBACK'].includes(fieldName);
                        const InputComponent = isTextarea ? 'textarea' : 'input';

                        return (
                            <div key={fieldName}>
                                {label}
                                <InputComponent
                                    id={fieldName}
                                    value={value?.toString() ?? ''}
                                    onChange={(e) => onDataChange(colIndex, e.target.value)}
                                    rows={isTextarea ? 3 : undefined}
                                    className="w-full bg-solar-light-bg dark:bg-solar-dark-bg border border-solar-light-border dark:border-solar-dark-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-solar-accent dark:text-gray-200"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default AnalysisForm;