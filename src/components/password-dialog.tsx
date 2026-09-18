'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';
import * as React from 'react';

interface PasswordDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onSave: (password: string) => void;
    title?: string;
    description?: string;
}

export function PasswordDialog({
    isOpen,
    onOpenChange,
    onSave,
    title,
    description
}: PasswordDialogProps) {
    const { t } = useI18n();
    const resolvedTitle = title ?? t('Configure Password');
    const [currentPassword, setCurrentPassword] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleSave = () => {
        inputRef.current?.blur();
        onSave(currentPassword);
        setCurrentPassword('');
        onOpenChange(false);
    };

    const handleDialogClose = (open: boolean) => {
        if (!open) {
            setCurrentPassword('');
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogClose}>
            <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[425px]'>
                <DialogHeader>
                    <DialogTitle className='text-slate-900'>{resolvedTitle}</DialogTitle>
                    {description && <DialogDescription className='text-slate-500'>{description}</DialogDescription>}
                </DialogHeader>
                <div className='grid gap-4 py-4'>
                    <div className='grid grid-cols-1 items-center gap-4'>
                        <Input
                            ref={inputRef}
                            id='password-input'
                            type='password'
                            placeholder={t('Enter your password')}
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className='col-span-1 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-indigo-100'
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && currentPassword.trim()) {
                                    e.preventDefault();
                                    handleSave();
                                }
                            }}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type='button'
                        onClick={handleSave}
                        disabled={!currentPassword.trim()}
                        className='bg-indigo-600 px-6 text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                        {t('Save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
