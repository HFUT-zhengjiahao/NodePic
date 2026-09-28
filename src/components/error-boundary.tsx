'use client';

import { Button } from '@/components/ui/button';
import * as React from 'react';

type ErrorBoundaryProps = {
    children: React.ReactNode;
    /** Heading shown instead of the broken subtree. */
    title: string;
    retryLabel: string;
    /** Optional extra cleanup when the user retries (e.g. dropping the persisted canvas). */
    onReset?: () => void;
};

type ErrorBoundaryState = { error: Error | null };

/**
 * Keeps one broken view from taking the whole page down.
 *
 * A canvas node built from a bad stored record used to throw while rendering, which unmounted
 * everything — sidebar, toolbar and history included — leaving a blank page and a console trace.
 * Wrapping each view means the failure stays visible and retryable, and the rest of the app keeps
 * working.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error('A view failed to render:', error, info.componentStack);
    }

    private handleRetry = (): void => {
        this.setState({ error: null });
        this.props.onReset?.();
    };

    render(): React.ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div
                role='alert'
                className='mx-auto my-8 max-w-lg space-y-3 rounded-xl border border-red-200 bg-red-50 p-5 text-slate-900'>
                <h2 className='text-sm font-semibold text-red-800'>{this.props.title}</h2>
                <p className='font-mono text-[11px] leading-relaxed break-words text-red-700'>{error.message}</p>
                <Button
                    type='button'
                    size='sm'
                    onClick={this.handleRetry}
                    className='bg-red-600 text-white hover:bg-red-500'>
                    {this.props.retryLabel}
                </Button>
            </div>
        );
    }
}
