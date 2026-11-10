
import React from 'react';
import Header from './components/Header';
import DailyVerseGenerator from './components/DailyVerseGenerator';
import VideoLibrary from './components/VideoLibrary';
import InstagramSyncPanel from './components/InstagramSyncPanel';
import WhatsAppPanel from './components/WhatsAppPanel';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-900 via-stone-900 to-stone-800 text-stone-100 pb-20 font-sans">
      {/* Hidden preloader to force browser to load required web fonts before canvas drawing */}
      <div
        style={{ opacity: 0, position: 'absolute', pointerEvents: 'none', top: 0, left: 0, height: 1, width: 1, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <span style={{ fontFamily: 'Cinzel' }}>Holy God</span>
        <span style={{ fontFamily: 'Montserrat' }}>Faith Hope Love</span>
        <span style={{ fontFamily: 'Dancing Script' }}>Grace Peace</span>
        <span style={{ fontFamily: 'Great Vibes' }}>Prayer</span>
        <span style={{ fontFamily: 'Cormorant Garamond' }}>Wisdom Life</span>
        <span style={{ fontFamily: 'Playfair Display' }}>Scripture Truth</span>
        <span style={{ fontFamily: 'Lora' }}>Devotional</span>
        <span style={{ fontFamily: 'Lato' }}>John Psalms</span>
        <span style={{ fontFamily: 'Noto Sans Tamil' }}>கர்த்தர் என் மேய்ப்பராயிருக்கிறார்</span>
        <span style={{ fontFamily: 'Noto Serif Tamil' }}>சிறுமைபட்டவர்களை</span>
        <span style={{ fontFamily: 'Noto Sans Telugu' }}>యెహోవా నా కాపరి</span>
        <span style={{ fontFamily: 'Noto Serif Telugu' }}>మనుష్యులు</span>
        <span style={{ fontFamily: 'Arima Madurai' }}>அன்பு சமாதானம்</span>
      </div>

      <div className="container mx-auto px-4 max-w-5xl">
        <Header />

        <main className="mt-8">
          <DailyVerseGenerator />
          <WhatsAppPanel />
          <VideoLibrary />
          <InstagramSyncPanel />
        </main>
      </div>
    </div>
  );
};

export default App;
