import React from 'react';

interface LoadingIndicatorProps {
    statusText: string;
    error?: string | null;
    onRetry?: () => void;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ statusText, error, onRetry }) => {
    return (
        <div className="w-full max-w-md text-center p-4">
            {error ? (
                <>
                    <h3 className="text-lg font-bold text-red-400 mb-2">Load Failed</h3>
                    <p className="text-sm text-gray-400 mb-4">{error}</p>
                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="px-4 py-2 bg-solar-accent text-white rounded-md hover:bg-solar-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-solar-dark-bg focus:ring-solar-accent"
                        >
                            Retry
                        </button>
                    )}
                </>
            ) : (
                <>
                    <div className="relative w-16 h-16 mx-auto mb-4">
                        <div className="w-full h-full border-4 border-solar-dark-border rounded-full"></div>
                        <div className="absolute inset-0 w-full h-full border-4 border-solar-accent border-t-transparent rounded-full animate-spin"></div>
                    </div>
                    <p key={statusText} className="text-sm text-gray-400 animate-text-fade-in h-5 flex items-center justify-center">
                        {statusText}
                    </p>
                </>
            )}
        </div>
    );
};

export default LoadingIndicator;