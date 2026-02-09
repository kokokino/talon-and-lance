import m from 'mithril';

export const ChatMessage = {
  view(vnode) {
    const { message, isOwn } = vnode.attrs;
    
    const formatTime = (date) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    
    return m('div.chat-message', { class: isOwn ? 'own-message' : '' }, [
      m('div.message-header', [
        m('span.username', message.username || 'Anonymous'),
        m('span.timestamp', formatTime(message.createdAt))
      ]),
      m('div.message-text', message.text)
    ]);
  }
};
