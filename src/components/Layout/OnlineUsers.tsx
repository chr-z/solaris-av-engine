import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/I18nContext';
// P3 standalone: presença é um serviço de nuvem (RTDB). Em builds sem nuvem
// este componente vira null ANTES de qualquer import/uso do firebase.
import { isStandalone } from '../../config/runtimeMode';
import { UserProfile } from '../../types';
import firebase from 'firebase/compat/app';
import { database } from '../../config/firebase';
import UserAvatar from '../Auth/UserAvatar';

const OnlineUsers: React.FC = () => {
    const { t } = useI18n();

    const standalone = isStandalone();
    const [onlineUsers, setOnlineUsers] = useState<UserProfile[]>([]);

    useEffect(() => {
        // Standalone: zero rede — nem listener de presença é registrado.
        if (standalone) return;
        const presenceRef = database.ref('presence');
        const listener = (snapshot: firebase.database.DataSnapshot) => {
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
        presenceRef.on('value', listener);

        return () => presenceRef.off('value', listener);
    }, [standalone]);

    // Standalone: sem nuvem não existe "usuários online" — nada pra mostrar.
    if (standalone) return null;

    if (onlineUsers.length === 0) return null;

    return (
        <div className="flex items-center -space-x-2" title={t('users.activeCount', { count: onlineUsers.length })}>
            {onlineUsers.slice(0, 5).map(user => (
                <UserAvatar 
                    key={user.id} 
                    user={user} 
                    className="w-8 h-8 rounded-full border-2 border-solar-dark-content" 
                />
            ))}
            {onlineUsers.length > 5 && (
                 <div className="w-8 h-8 rounded-full border-2 border-solar-dark-content bg-gray-600 flex items-center justify-center text-xs font-bold">
                    +{onlineUsers.length - 5}
                </div>
            )}
        </div>
    );
};

export default OnlineUsers;