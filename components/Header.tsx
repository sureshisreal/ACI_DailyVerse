import React from 'react';
import ministryLogoUrl from './ACI.png';

const Header: React.FC = () => {
  return (
    <header className="py-8 px-4 text-center">
      <div className="flex flex-col items-center justify-center gap-4 mb-4">
        <div className="p-3 bg-stone-800/50 rounded-2xl border border-stone-700 shadow-xl shadow-black/50 backdrop-blur-sm">
          <img
            src={ministryLogoUrl}
            alt="The Apostolic Church of India Logo"
            className="w-20 h-20 object-contain drop-shadow-lg"
          />
        </div>
        <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-stone-100 tracking-wider">
              The Apostolic Church of India
            </h1>
        </div>
      </div>
    </header>
  );
};

export default Header;
