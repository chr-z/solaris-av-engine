import React, { useState, useEffect } from 'react';
import { database } from '../../config/firebase';
import { UserProfile } from '../../types';
import UserAvatar from '../Auth/UserAvatar';

const OnlineUsers: React.FC = () => {
    const [onlineUsers, setOnlineUsers] = useState<UserProfile[]>([]);

    useEffect(() => {
        const presenceRef = database.ref('presence');
        const listener = (snapshot: any) => {
            const presences = snapshot.val() || {};
            const currentOnlineUsers: UserProfile[] = [];
            Object.values(presences).forEach((presence: any) => {
                if (presence.status === 'online') {
                    currentOnlineUsers.push(presence);
                }
            });
            setOnlineUsers(currentOnlineUsers);
        };
        presenceRef.on('value', listener);

        return () => presenceRef.off('value', listener);
    }, []);

    if (onlineUsers.length === 0) return null;

    return (
        <div className="flex items-center -space-x-2" title={`${onlineUsers.length} active user(s)`}>
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