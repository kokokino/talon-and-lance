import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { ChatMessages } from '../../lib/collections/chatMessages.js';
import { ChatMessage } from './ChatMessage.js';

export const ChatRoom = {
  oninit(vnode) {
    vnode.state.messages = [];
    vnode.state.newMessage = '';
    vnode.state.sending = false;
    vnode.state.error = null;
    vnode.state.subscription = null;
    vnode.state.computation = null;
  },
  
  oncreate(vnode) {
    // Subscribe to chat messages
    vnode.state.subscription = Meteor.subscribe('chatMessages');
    
    // Set up reactive computation to track messages
    vnode.state.computation = Tracker.autorun(() => {
      vnode.state.messages = ChatMessages.find({}, { 
        sort: { createdAt: 1 } 
      }).fetch();
      m.redraw();
    });
  },
  
  onremove(vnode) {
    if (vnode.state.subscription) {
      vnode.state.subscription.stop();
    }
    if (vnode.state.computation) {
      vnode.state.computation.stop();
    }
  },
  
  async sendMessage(vnode) {
    const text = vnode.state.newMessage.trim();
    if (!text || vnode.state.sending) return;
    
    vnode.state.sending = true;
    vnode.state.error = null;
    m.redraw();
    
    try {
      await Meteor.callAsync('chat.send', text);
      vnode.state.newMessage = '';
    } catch (error) {
      console.error('Failed to send message:', error);
      vnode.state.error = error.reason || error.message || 'Failed to send message';
    } finally {
      vnode.state.sending = false;
      m.redraw();
    }
  },
  
  scrollToBottom(vnode) {
    const messagesEl = vnode.dom.querySelector('.chat-messages');
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  },
  
  onupdate(vnode) {
    // Auto-scroll to bottom when new messages arrive
    this.scrollToBottom(vnode);
  },
  
  view(vnode) {
    const { messages, newMessage, sending, error } = vnode.state;
    const currentUserId = Meteor.userId();
    
    return m('div.chat-container', [
      // Messages list
      m('div.chat-messages', 
        messages.length === 0 ?
          m('p', { style: 'text-align: center; color: var(--pico-muted-color);' }, 
            'No messages yet. Start the conversation!') :
          messages.map(msg => 
            m(ChatMessage, { 
              key: msg._id, 
              message: msg,
              isOwn: msg.userId === currentUserId
            })
          )
      ),
      
      // Error message
      error && m('div.error-message', error),
      
      // Input form
      m('form.chat-input-form', {
        onsubmit(e) {
          e.preventDefault();
          ChatRoom.sendMessage(vnode);
        }
      }, [
        m('div', { role: 'group' }, [
          m('input[type=text]', {
            placeholder: 'Type a message...',
            value: newMessage,
            disabled: sending,
            oninput(e) {
              vnode.state.newMessage = e.target.value;
            },
            onkeydown(e) {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ChatRoom.sendMessage(vnode);
              }
            }
          }),
          m('button[type=submit]', {
            disabled: sending || !newMessage.trim()
          }, sending ? '...' : 'Send')
        ])
      ])
    ]);
  }
};
