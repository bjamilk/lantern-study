import React, { useState, useEffect, useRef } from 'react';
import { MicrophoneIcon } from '@heroicons/react/24/solid';

// Manually define the SpeechRecognition interface for browsers that support it.
interface SpeechRecognition {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start: () => void;
    stop: () => void;
    onstart: (() => void) | null;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
}

interface VoiceInputButtonProps {
    onTranscriptUpdate: (transcript: string) => void;
    className?: string;
    disabled?: boolean;
}

// @ts-ignore
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const isSupported = !!SpeechRecognitionAPI;

const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ onTranscriptUpdate, className, disabled = false }) => {
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    useEffect(() => {
        if (!isSupported) {
            console.warn("Speech recognition is not supported by this browser.");
            return;
        }

        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsListening(true);
        };

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            onTranscriptUpdate(transcript);
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            setIsListening(false);
        };
        
        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            recognitionRef.current?.stop();
        };
    }, [onTranscriptUpdate]);

    const handleToggleListening = () => {
        if (disabled || !isSupported) return;

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            try {
                recognitionRef.current?.start();
            } catch(e) {
                console.error("Could not start recognition", e);
                setIsListening(false);
            }
        }
    };

    if (!isSupported) {
        return null; // Or a disabled button with a tooltip
    }

    return (
        <button
            type="button"
            onClick={handleToggleListening}
            disabled={disabled}
            className={`flex-shrink-0 p-2 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed ${
                isListening
                    ? 'bg-red-500 text-white animate-pulse focus:ring-red-400'
                    : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 focus:ring-blue-500'
            } ${className}`}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop voice input' : 'Start voice input'}
        >
            <MicrophoneIcon className="w-5 h-5" />
        </button>
    );
};

export default VoiceInputButton;