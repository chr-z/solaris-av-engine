import React from 'react';

interface UserAvatarProps {
  user: {
    name: string;
    picture: string;
  };
  className?: string;
}

const UserAvatar: React.FC<UserAvatarProps> = ({ user, className = '' }) => {
  return (
    <div className={`relative inline-block ${className}`} title={user.name}>
      <img
        src={user.picture}
        alt={user.name}
        className="w-full h-full rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

export default UserAvatar;