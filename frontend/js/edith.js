// Edith - AI Virtual Assistant module
// Provides text/speech dialog, speech-to-text voice input, and activity summaries

(function () {
  let panel = null;
  let bubble = null;
  let recognition = null;
  let isListening = false;

  function initEdith() {
    bubble = document.getElementById('edith-bubble');
    panel = document.getElementById('edith-panel');
    const closeBtn = document.getElementById('edith-close');
    const micBtn = document.getElementById('edith-mic-btn');
    const sendBtn = document.getElementById('edith-send-btn');
    const input = document.getElementById('edith-input');

    // Dedicated View elements
    const viewInput = document.getElementById('edith-view-input');
    const viewSendBtn = document.getElementById('edith-view-send-btn');
    const viewMicBtn = document.getElementById('edith-view-mic-btn');

    if (bubble && panel) {
      // Toggle panel
      bubble.onclick = () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
          if (input) input.focus();
          if (window.speechSynthesis) window.speechSynthesis.getVoices();
        }
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        panel.classList.add('hidden');
        if (isListening && recognition) recognition.stop();
      };
    }

    // Floating panel inputs
    if (sendBtn && input) {
      sendBtn.onclick = () => {
        const val = input.value;
        if (val.trim()) handleUserMessage(val);
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const val = input.value;
          if (val.trim()) handleUserMessage(val);
        }
      };
    }

    if (micBtn) {
      micBtn.onclick = () => toggleListening();
    }

    // Dedicated view inputs
    if (viewSendBtn && viewInput) {
      viewSendBtn.onclick = () => {
        const val = viewInput.value;
        if (val.trim()) handleUserMessage(val);
      };

      viewInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const val = viewInput.value;
          if (val.trim()) handleUserMessage(val);
        }
      };
    }

    if (viewMicBtn) {
      viewMicBtn.onclick = () => toggleListening();
    }

    // Suggestion chips (works for both floating panel and full-screen view)
    document.querySelectorAll('.edith-sug-chip, .edith-view-sug-chip').forEach(chip => {
      chip.onclick = () => {
        const query = chip.dataset.query;
        if (query) handleUserMessage(query);
      };
    });
  }

  function handleUserMessage(text) {
    if (!text || !text.trim()) return;
    appendChat('user', text);

    const input = document.getElementById('edith-input');
    if (input) input.value = '';
    const viewInput = document.getElementById('edith-view-input');
    if (viewInput) viewInput.value = '';

    const response = generateEdithResponse(text);

    setTimeout(() => {
      appendChat('edith', response);
      speak(response);
    }, 450);
  }

  function appendChat(sender, msgText) {
    const log = document.getElementById('edith-chat-log');
    if (log) {
      const msg = document.createElement('div');
      msg.className = `edith-msg ${sender}`;
      msg.innerHTML = msgText.replace(/\n/g, '<br>');
      log.appendChild(msg);
      log.scrollTop = log.scrollHeight;
    }

    const viewLog = document.getElementById('edith-view-chat-log');
    if (viewLog) {
      const msg = document.createElement('div');
      msg.className = `edith-msg ${sender}`;
      msg.innerHTML = msgText.replace(/\n/g, '<br>');
      viewLog.appendChild(msg);
      viewLog.scrollTop = viewLog.scrollHeight;
    }
  }

  function speak(text) {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\*/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const voices = window.speechSynthesis.getVoices();
    
    // Sort and prioritize high-fidelity online/natural neural female voices
    let femaleVoice = voices.find(v => {
      const name = v.name.toLowerCase();
      return (name.includes('natural') || name.includes('online') || name.includes('neural')) &&
             (name.includes('aria') || name.includes('jenny') || name.includes('sonia') || name.includes('female') || name.includes('samantha') || name.includes('zira'));
    });
    
    if (!femaleVoice) {
      femaleVoice = voices.find(v => {
        const name = v.name.toLowerCase();
        return name.includes('google') && (name.includes('female') || name.includes('us english') || name.includes('uk english'));
      });
    }
    
    if (!femaleVoice) {
      femaleVoice = voices.find(v => {
        const name = v.name.toLowerCase();
        return name.includes('zira') || name.includes('samantha') || name.includes('hazel') || name.includes('eva') || name.includes('sabina') || name.includes('female') || name.includes('haruka');
      });
    }
    
    if (!femaleVoice) {
      femaleVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('sabrina'));
    }
    
    if (!femaleVoice) {
      femaleVoice = voices.find(v => v.lang.startsWith('en'));
    }

    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    // Hot, smooth conversational female voice tuning: slightly lower pitch + slower rate
    utterance.pitch = 1.03; 
    utterance.rate = 0.92;  

    const wave = document.querySelector('.edith-soundwave');
    const viewWave = document.querySelector('.edith-view-soundwave');
    const statusEl = document.querySelector('.edith-status');
    const viewStatusEl = document.querySelector('.edith-view-status');

    utterance.onstart = () => {
      if (wave) { wave.classList.add('speaking'); wave.classList.remove('listening'); }
      if (viewWave) { viewWave.classList.add('speaking'); viewWave.classList.remove('listening'); }
      if (statusEl) statusEl.textContent = 'Edith is speaking...';
      if (viewStatusEl) viewStatusEl.textContent = 'Edith is speaking...';
    };

    utterance.onend = () => {
      if (wave) wave.classList.remove('speaking');
      if (viewWave) viewWave.classList.remove('speaking');
      if (statusEl) statusEl.textContent = 'Ready';
      if (viewStatusEl) viewStatusEl.textContent = 'Ready';
    };

    window.speechSynthesis.speak(utterance);
  }

  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListening = true;
      const wave = document.querySelector('.edith-soundwave');
      const viewWave = document.querySelector('.edith-view-soundwave');
      const btn = document.getElementById('edith-mic-btn');
      const viewBtn = document.getElementById('edith-view-mic-btn');
      const statusEl = document.querySelector('.edith-status');
      const viewStatusEl = document.querySelector('.edith-view-status');

      if (wave) { wave.classList.add('listening'); wave.classList.remove('speaking'); }
      if (viewWave) { viewWave.classList.add('listening'); viewWave.classList.remove('speaking'); }
      if (btn) btn.classList.add('active');
      if (viewBtn) viewBtn.classList.add('active');
      if (statusEl) statusEl.textContent = 'Listening to voice...';
      if (viewStatusEl) viewStatusEl.textContent = 'Listening to voice...';

      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };

    recognition.onend = () => {
      isListening = false;
      const wave = document.querySelector('.edith-soundwave');
      const viewWave = document.querySelector('.edith-view-soundwave');
      const btn = document.getElementById('edith-mic-btn');
      const viewBtn = document.getElementById('edith-view-mic-btn');
      const statusEl = document.querySelector('.edith-status');
      const viewStatusEl = document.querySelector('.edith-view-status');

      if (wave) wave.classList.remove('listening');
      if (viewWave) viewWave.classList.remove('listening');
      if (btn) btn.classList.remove('active');
      if (viewBtn) viewBtn.classList.remove('active');
      if (statusEl && statusEl.textContent === 'Listening to voice...') {
        statusEl.textContent = 'Ready';
      }
      if (viewStatusEl && viewStatusEl.textContent === 'Listening to voice...') {
        viewStatusEl.textContent = 'Ready';
      }
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      const input = document.getElementById('edith-input');
      if (input) input.value = text;
      const viewInput = document.getElementById('edith-view-input');
      if (viewInput) viewInput.value = text;
      handleUserMessage(text);
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e);
      const statusEl = document.querySelector('.edith-status');
      if (statusEl) statusEl.textContent = 'Error capturing voice';
      const viewStatusEl = document.querySelector('.edith-view-status');
      if (viewStatusEl) viewStatusEl.textContent = 'Error capturing voice';
    };
  }

  function toggleListening() {
    if (!recognition) {
      initSpeechRecognition();
    }
    if (!recognition) {
      alert('Speech recognition is not supported in this browser environment.');
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  }

  // Smarter window title content parser
  function parseAppActivity(appTitle) {
    if (!appTitle) return '';
    const lower = appTitle.toLowerCase();
    
    // Editors / IDEs
    if (lower.includes('visual studio code') || lower.includes('vscode') || lower.includes('sublime') || lower.includes('notepad++')) {
      const parts = appTitle.split(' - ');
      if (parts.length >= 2) {
        const fileName = parts[0].trim();
        const folderName = parts[1].trim();
        return `coding in VS Code on file \`${fileName}\` under folder \`${folderName}\``;
      }
      return 'coding in Visual Studio Code';
    }
    
    // Web Browsers
    if (lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox') || lower.includes('opera') || lower.includes('brave') || lower.includes('browser')) {
      const cleanedTitle = appTitle.replace(/ - (Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi)$/i, '').trim();
      if (lower.includes('github')) {
        return `reviewing code on GitHub (\`${cleanedTitle}\`)`;
      }
      if (lower.includes('stack overflow') || lower.includes('stackoverflow')) {
        return `debugging code via Stack Overflow (\`${cleanedTitle}\`)`;
      }
      if (lower.includes('figma')) {
        return `designing interfaces in Figma (\`${cleanedTitle}\`)`;
      }
      if (lower.includes('youtube')) {
        return `watching a tutorial video on YouTube (\`${cleanedTitle}\`)`;
      }
      if (lower.includes('meet.google') || lower.includes('zoom') || lower.includes('teams')) {
        return `in a video conference call (\`${cleanedTitle}\`)`;
      }
      return `browsing \`${cleanedTitle}\` in browser`;
    }
    
    // Media players
    if (lower.includes('spotify')) {
      const cleaned = appTitle.replace(/^Spotify( Free| Premium)?( - )?/i, '').trim();
      if (cleaned && cleaned !== 'Spotify') {
        return `listening to "${cleaned}" on Spotify`;
      }
      return 'listening to Spotify';
    }
    
    // Slack / Discord
    if (lower.includes('discord')) return 'collaborating on Discord';
    if (lower.includes('slack')) return 'chatting on Slack';
    if (lower.includes('whatsapp') || lower.includes('telegram')) return 'chatting on social messenger';
    
    // Shell terminal
    if (lower.includes('cmd') || lower.includes('powershell') || lower.includes('bash') || lower.includes('git bash') || lower.includes('terminal')) {
      return 'running scripts in the terminal';
    }

    const appClean = appTitle.split(' - ')[0].trim();
    return `active in \`${appClean}\``;
  }

  function generateEdithResponse(query) {
    const q = query.toLowerCase();
    
    // Access global variables from app.js directly (since ES6 let doesn't attach to window)
    const currentUsersList = typeof users !== 'undefined' ? users : [];
    const activeUsers = currentUsersList.filter(u => u.status === 'online' || u.status === 'away' || u.status === 'busy');
    const localCurrentUser = typeof currentUser !== 'undefined' ? currentUser : null;

    // 1. Teammates Work / Activity Summary (Refined Conversational Paragraphs)
    if (q.includes('summary') || q.includes('summarize') || q.includes('doing') || q.includes('making') || q.includes('work') || q.includes('activity') || q.includes('project')) {
      if (activeUsers.length === 0) {
        return "There's no one online in the virtual office at the moment. It's quiet here!";
      }

      // Find self
      const selfUser = localCurrentUser ? activeUsers.find(u => String(u.id) === String(localCurrentUser.id)) : null;
      // Find others
      const otherUsers = localCurrentUser ? activeUsers.filter(u => String(u.id) !== String(localCurrentUser.id)) : activeUsers;

      let responseParagraphs = [];

      // User's own status
      if (selfUser) {
        let selfActivity = [];
        let parsedApp = (selfUser.apps && selfUser.apps.length > 0) ? parseAppActivity(selfUser.apps[0]) : '';
        if (parsedApp) {
          selfActivity.push(parsedApp);
        } else {
          const isDesktop = typeof window.electronAPI !== 'undefined';
          if (!isDesktop) {
            selfActivity.push("collaborating in the browser (launch the Desktop App to enable active window monitoring)");
          } else {
            selfActivity.push("collaborating in the office (please restart your desktop app to activate the new process scanner)");
          }
        }
        if (selfUser.current_project) {
          selfActivity.push(`contributing to the "${selfUser.current_project}" project`);
        }
        if (selfUser.current_view && selfUser.current_view !== 'office') {
          selfActivity.push(`focusing on the ${selfUser.current_label || selfUser.current_view} panel`);
        }

        const selfDetails = selfActivity.length > 0 
          ? selfActivity.join(', and you are ')
          : 'collaborating in the office';

        responseParagraphs.push(`Right now, **you** are online, ${selfDetails}.`);
      }

      // Teammate status
      if (otherUsers.length > 0) {
        let teammateLines = [];
        otherUsers.forEach(u => {
          let uActivity = [];
          let parsedApp = (u.apps && u.apps.length > 0) ? parseAppActivity(u.apps[0]) : '';
          if (parsedApp) {
            uActivity.push(parsedApp);
          }
          if (u.current_project) {
            uActivity.push(`working on project "${u.current_project}"`);
          }
          if (u.current_view && u.current_view !== 'office') {
            uActivity.push(`viewing the ${u.current_label || u.current_view} tab`);
          }

          const uDetails = uActivity.length > 0 
            ? uActivity.join(', and they are ')
            : 'active in the workspace';

          teammateLines.push(`**${u.username}** (${u.status}) is ${uDetails}`);
        });

        responseParagraphs.push(`For the rest of the team, ` + teammateLines.join('. ') + `.`);
      } else {
        responseParagraphs.push("It looks like you're the only one logged in right now. The office is quiet, giving you plenty of room to focus!");
      }

      return responseParagraphs.join("\n\n");
    }

    // 2. Who is online
    if (q.includes('online') || q.includes('active') || q.includes('who is here') || q.includes('status')) {
      if (activeUsers.length === 0) {
        return "Nobody is online at the moment.";
      }
      const list = activeUsers.map(u => `${u.username} (${u.status})`).join(', ');
      return `The active team members are: ${list}.`;
    }

    // 3. Open applications check
    if (q.includes('app') || q.includes('program') || q.includes('software') || q.includes('window')) {
      let appList = [];
      activeUsers.forEach(u => {
        if (u.apps && u.apps.length > 0) {
          appList.push(`• **${u.username}**: ${u.apps.join(', ')}`);
        }
      });
      if (appList.length === 0) {
        return "No active applications are reported by teammates right now.";
      }
      return "Here are the open windows and applications on the team:\n" + appList.join('\n');
    }

    // 4. Basic FAQs / Help
    if (q.includes('hello') || q.includes('hi') || q.includes('hey') || q.includes('greetings')) {
      const name = localCurrentUser ? localCurrentUser.username : 'there';
      return `Hello, ${name}! I'm Edith. Ask me to "summarize activity" or ask "who is online".`;
    }
    if (q.includes('how are you')) {
      return "I am online and running at full efficiency. Thank you for asking!";
    }
    if (q.includes('what is this') || q.includes('what do you do') || q.includes('help')) {
      return "I'm Edith, your Virtual Office AI. I monitor teammate projects, tab views, and open applications to keep everyone coordinated. Ask me to 'summarize activity' or 'what apps are open'!";
    }
    if (q.includes('joke')) {
      const jokes = [
        "Why do programmers wear glasses? Because they can't C#!",
        "How many programmers does it take to change a light bulb? None, that's a hardware problem.",
        "There are 10 types of people in the world: those who understand binary, and those who don't."
      ];
      return jokes[Math.floor(Math.random() * jokes.length)];
    }

    return "I'm not sure how to process that. You can ask me to 'summarize activity', see 'who is online', or tell you 'what apps are open'.";
  }

  // Load when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEdith);
  } else {
    initEdith();
  }
})();
