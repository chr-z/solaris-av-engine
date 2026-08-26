import React, { useState, useEffect } from 'react';
import { getDb, getFirebaseCompat, isFirebaseConfigured, type SnapshotLike } from '../../config/firebase';
type DbSnapshot = SnapshotLike;
import { UserProfile } from '../../types';
import UserAvatar from '../Auth/UserAvatar';
import { useI18n } from '../../i18n/I18nContext';

const OnlineUsers: React.FC = () => {
    const { t } = useI18n();
    const [onlineUsers, setOnlineUsers] = useState<UserProfile[]>([]);

    useEffect(() => {
        // turbo-web: presence subscription waits for the lazy SDK; skipped if unmounted first.
        let listener: ((snapshot: DbSnapshot) => void) | null = null;
        let presenceRef: ReturnType<Awaited<ReturnType<typeof getDb>>['ref']> | null = null;
        listener = (snapshot: DbSnapshot) => {
            // Presence nodes are UserProfile + presence metadata written by App's presence system
            const presences: Record<string, UserProfile & { status?: string }> = snapshot.val() || {};
            const currentOnlineUsers: UserProfile[] = [];
            Object.values(presences).forEach((presence) => {
                if (presence.status === 'online') {
                    currentOnlineUsers.push(presence);
                }
            });
            setOnlineUsers(currentOnlineUsers);
        };
        let disposed = false;
        // turbo-web: offline/demo builds have no Firebase config — stay silent.
        if (!isFirebaseConfigured()) return;
        getFirebaseCompat().then(() => getDb()).then((db) => {
            if (disposed) return;
            presenceRef = db.ref('presence');
            presenceRef.on('value', listener!);
        }).catch((err) => console.error('Failed to load presence module:', err));

        return () => {
            disposed = true;
            if (presenceRef && listener) presenceRef.off('value', listener);
        };
    }, []);

    if (onlineUsers.length === 0) return null;

    return (
        <div className="flex items-center -space-x-2" title={t('users.activeCount', { count: onlineUsers.length })}>
            {onlineUsers.slice(0, 5).map(user => (
                <UserAvatar 
                    key={user.id} 
                    user={user} 
                    className="w-8 h-8 rounded-full border-2 border-surface" 
                />
            ))}
            {onlineUsers.length > 5 && (
                 <div className="w-8 h-8 rounded-full border-2 border-surface bg-gray-600 flex items-center justify-center text-xs font-bold">
                    +{onlineUsers.length - 5}
                </div>
            )}
        </div>
    );
};

export default OnlineUsers;