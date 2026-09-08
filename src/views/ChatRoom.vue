<template>
<div v-if="state.chat" class="chat-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="closeChat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </div>
      <div class="avatar" :style="{ width: '38px', height: '38px', fontSize: '15px', background: avatarColor(convName(state.chat)) }"><img v-if="convAvatar(state.chat)" :src="convAvatar(state.chat)" alt=""><template v-else>{{ convInitial(state.chat) }}</template></div>
      <div class="chat-title-wrap" @click="openInfo">
        <div class="chat-title">{{ convName(state.chat) }}</div>
        <div class="chat-status">{{ chatStatus }}</div>
      </div>
      <div class="topbar-icon" @click="toggleChatSearch" title="搜索消息">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <div class="topbar-icon todo-btn" @click="showTofuTodo = true" title="密钥待办">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span v-if="pendingCount" class="todo-dot">{{ pendingCount > 9 ? '9+' : pendingCount }}</span>
      </div>
    </div>

    <!-- ═══════ 会话内消息搜索面板 ═══════ -->
    <div v-if="chatSearchOpen" class="chat-search-panel">
      <div class="chat-search-bar">
        <input class="chat-search-input" v-model="chatSearchKeyword" @input="onChatSearchInput" placeholder="搜索消息（至少2个字符）" autofocus>
        <div class="chat-search-close" @click="closeChatSearch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </div>
      </div>
      <div class="chat-search-results" @scroll="onSearchScroll">
        <div v-if="chatSearchLoading && !chatSearchResults.length" class="chat-search-empty">搜索中…</div>
        <div v-else-if="chatSearchKeyword.length >= 2 && !chatSearchResults.length && !chatSearchLoading" class="chat-search-empty">未找到相关消息</div>
        <div v-else-if="chatSearchKeyword.length < 2" class="chat-search-empty">输入至少 2 个字符开始搜索</div>
        <div v-for="(m, i) in chatSearchResults" :key="m.id" class="chat-search-item" @click="onSearchResultClick(m)">
          <div class="csi-head">
            <span class="csi-name">{{ m.sender_name || senderName(m) || '未知' }}</span>
            <span class="csi-time">{{ fmtSearchTime(m.created_at) }}</span>
          </div>
          <div class="csi-content" v-html="highlightKeyword(m.content || m.file_name || '[文件消息]', chatSearchKeyword)"></div>
        </div>
        <div v-if="chatSearchLoading && chatSearchResults.length" class="chat-search-more">加载中…</div>
      </div>
    </div>

    <!-- TOFU 公钥变更告警横幅（仅当前会话涉及的密钥变更才显示） -->
    <div v-if="chatTofuAlerts.length" class="tofu-banners">
      <div v-for="a in chatTofuAlerts" :key="a.user_id" class="tofu-banner">
        <span class="tofu-banner-text"><svg class="tofu-warn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>「{{ a.name }}」的安全密钥已变更（可能是对方换了手机/重装，也可能是密钥被替换）</span>
        <button class="tofu-btn" @click="confirmTofuKey(a.user_id)">确认信任新密钥</button>
        <button class="tofu-btn ghost" @click="dismissTofuAlert(a.user_id)">稍后处理</button>
      </div>
    </div>

    <div v-if="state.burnSeconds" class="burn-banner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B25E00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      阅后即焚已开启：消息将在 {{ burnLabel }} 后销毁<span v-if="state.e2eOn"> · 明文加密（端到端密文）</span>
    </div>

    <div class="msg-scroll" ref="msgBox" @scroll="onMsgScroll">
      <div v-if="state.hasMore" style="text-align:center;color:#707579;font-size:13px;padding:8px;cursor:pointer" @click="loadEarlier">{{ state.loadingEarlier ? '加载中…' : '加载更早的消息' }}</div>
      <div v-if="state.msgLoading" style="text-align:center;color:#707579;font-size:13px;padding:8px">加载中…</div>
      <template v-for="(m, i) in state.messages" :key="msgKey(m, i)">
        <div class="msg-row" :id="'msg-' + m.id" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }">
          <div v-if="m.sender_id !== state.me.id && state.chat.type !== 'private'" class="msg-avatar avatar" @contextmenu.prevent.stop="mentionSender(m)" @touchstart="mentionPressStart($event, m)" @touchend="mentionPressEnd" @touchmove="mentionPressCancel" @touchcancel="mentionPressCancel" :style="{ width: '28px', height: '28px', fontSize: '12px', background: avatarColor(senderName(m)) }"><img v-if="senderAvatar(m)" :src="senderAvatar(m)" alt=""><template v-else>{{ senderName(m)[0] }}</template></div>
          <div class="msg-body" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id, img: isImgMsg(m), video: isVideoMsg(m) }">
            <div class="bubble" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id, img: isImgMsg(m), video: isVideoMsg(m) }" @click="onBubbleClick(m)" @contextmenu.prevent="onMsgTap(m)">
            <div v-if="state.chat.type !== 'private' && m.sender_id !== state.me.id" class="sender-name">{{ senderName(m) }}</div>
            
            <template v-if="m.is_recalled"><span class="msg-recalled">此消息已撤回</span></template>
            <template v-else-if="isBurned(m)"><span class="msg-recalled">此消息已焚毁</span></template>
            <template v-else-if="isBlurredBurn(m)"><span class="burn-blur" :class="{ enc: isEnc(m) }"><svg v-if="isEnc(m)" class="blur-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" stroke="currentColor" stroke-width="2"/><rect x="9.6" y="11.6" width="4.8" height="3.9" rx="1" fill="currentColor" stroke="currentColor" stroke-width="1.2"/><path d="M10.6 11.6V9.3a1.4 1.4 0 0 1 2.8 0v2.3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg><span v-else class="blur-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.7c-1.1 3.2 1.4 4.9 2.9 6.6 1.5 1.7 2.8 3.6 2.8 5.9a7.2 7.2 0 1 1-14.4 0c0-2.9 1.6-5 3.2-6.8.5 1.8 1.6 2.8 2.8 3.4.1-2.8-.5-5.8 2.7-9.1z"/></svg></span>{{ burnBlurText(m) }}</span></template>
            <template v-else-if="m.type === 'image' && m.file_url">
              <div class="msg-image-wrap">
                <img class="msg-image" :src="imgSrc(m)" @load="scrollBottom" @error="onImgErr(m)">
                <span v-if="m.file_size" class="msg-image-size">{{ fmtSize(m.file_size) }}</span>
              </div>
              <div v-if="m.content" class="img-caption">{{ m.content }}</div>
            </template>
            <template v-else-if="m.type === 'voice' && m.file_url">
              <div class="msg-voice" :class="{ playing: playVoiceId === m.id }" :style="{ width: voiceBarWidth(m) }" @click.stop="togglePlayVoice(m)" title="点击播放">
                <svg class="voice-wave" width="20" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="9" width="3" height="6" rx="1.5"/><rect x="10" y="5" width="3" height="14" rx="1.5"/><rect x="17" y="8" width="3" height="8" rx="1.5"/></svg>
                <span class="voice-dur">{{ voiceDur(m) }}&#8243;</span>
              </div>
            </template>
            <template v-else-if="isVideoMsg(m)">
              <div class="msg-video" @click.stop="openFile(m)">
                <video class="msg-video-thumb" :src="fileURL(m.file_url)" preload="metadata" muted playsinline webkit-playsinline @loadedmetadata="seekVideoThumb"></video>
                <div class="msg-video-play"><span><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg></span></div>
                <div class="msg-video-size">{{ fmtSize(m.file_size) }}</div>
              </div>
              <div v-if="m.content" class="img-caption">{{ m.content }}</div>
            </template>
            <template v-else-if="m.type === 'file'">
              <div class="msg-file" @click.stop="openFile(m)">
                <div class="msg-file-icon">
                  <svg width="36" height="44" viewBox="0 0 36 44" aria-hidden="true">
                    <path d="M0 6 Q0 0 6 0 H22 L36 16 V38 Q36 44 30 44 H6 Q0 44 0 38 Z" :fill="fileTypeInfo(m).bgColor"/>
                    <path d="M22 0 L36 16 L20 14 Z" fill="rgba(0,0,0,.25)"/>
                    <path d="M22 0 L36 16" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>
                  </svg>
                  <span class="msg-file-icon-text">{{ fileTypeInfo(m).label }}</span>
                </div>
                <div class="msg-file-info"><div class="msg-file-name">{{ m.file_name || '附件' }}</div><div class="msg-file-size">{{ fmtSize(m.file_size) }}</div></div>
              </div>
              <div v-if="m.content" style="margin-top:4px">{{ m.content }}</div>
            </template>
            <template v-else>
              <template v-if="isEnc(m) && !isBurnMsg(m) && reveal[e2eKey(m)]"><svg class="e2e-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" title="端到端加密消息"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> <span v-html="renderMentionHtml(m.content)"></span><span class="e2e-count">{{ revealLeft[e2eKey(m)] }}s</span></template>
              <template v-else-if="isEnc(m) && !isBurnMsg(m)"><span class="e2e-reveal"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> 加密消息 · 点击查看</span></template>
              <template v-else><span v-html="renderMentionHtml(m.content)"></span></template>
            </template>
            
            <div v-if="burnVisible(m)" class="burn-chip" :class="{ enc: isEnc(m) }">
              <svg v-if="isEnc(m)" class="chip-ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" stroke="currentColor" stroke-width="2.2"/><rect x="9.8" y="11.7" width="4.4" height="3.6" rx="1" fill="currentColor"/><path d="M10.8 11.7V9.5a1.2 1.2 0 0 1 2.4 0v2.2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
              <svg v-else class="chip-ico" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.7c-1.1 3.2 1.4 4.9 2.9 6.6 1.5 1.7 2.8 3.6 2.8 5.9a7.2 7.2 0 1 1-14.4 0c0-2.9 1.6-5 3.2-6.8.5 1.8 1.6 2.8 2.8 3.4.1-2.8-.5-5.8 2.7-9.1z"/></svg>{{ burnCountdown(m) }}
            </div>
          </div>
            <div v-if="replyQuote(m)" class="reply-quote" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }" @click.stop="jumpToReply(m)"><span class="rq-name">{{ replyQuote(m).name }}</span><span class="rq-text">{{ replyQuote(m).text }}</span></div>
            <div v-if="groupReadInfo(m)" class="group-read" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }">
              <template v-if="groupReadInfo(m).kind === 'atAll'">
                <div class="gr-avatars">
                  <div v-for="(r, ri) in groupReadInfo(m).readers.slice(0, 8)" :key="r.user_id || ri" class="gr-avatar" :style="{ background: avatarColor(r.name) }">
                    <img v-if="r.avatar" :src="r.avatar" alt=""><template v-else>{{ (r.name || '?')[0] }}</template>
                  </div>
                </div>
                <span class="gr-count">{{ groupReadInfo(m).readCount ? groupReadInfo(m).readCount + ' 人已读' : '未读' }}</span>
              </template>
              <template v-else>
                <span class="gr-one" :class="{ read: groupReadInfo(m).read }">{{ groupReadInfo(m).targetName }} {{ groupReadInfo(m).read ? '已读' : '未读' }}</span>
              </template>
            </div>
            <span class="msg-meta">
            <span v-if="m.is_edited">已编辑 · </span>{{ fmtClock(m.created_at) }}
            <span v-if="m.sender_id === state.me.id && !m.is_recalled && state.chat.type === 'private'" class="read-tag" :class="{ unread: !isPeerRead(m) }">{{ isPeerRead(m) ? '已读' : '未读' }}</span>
            </span>
        </div>
        </div>
        
      </template>
      <div v-if="!state.messages.length && !state.msgLoading" class="empty-state" style="padding-top:60px"><div>暂无消息<br><small>发出第一条消息，开始加密通讯</small></div></div>
    </div>

    <!-- 新消息浮钮：上滑看历史期间收到新消息时显示，点击直达最新 -->
    <div v-if="newMsgPill" class="new-msg-pill" @click="jumpToLatest">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      新消息
    </div>

    <!-- 编辑消息提示条 -->
    <div v-if="editing && !channelReadonly" class="edit-bar">
      <div style="flex:1;min-width:0">
        <div class="edit-bar-title">编辑消息</div>
        <div class="edit-bar-text">{{ editing.content }}</div>
      </div>
      <div class="edit-bar-close" @click="cancelEdit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></div>
    </div>

    <!-- 引用回复提示条 -->
    <div v-if="replyTo && !channelReadonly" class="edit-bar reply-bar">
      <div style="flex:1;min-width:0">
        <div class="edit-bar-title">回复 {{ senderName(replyTo) }}</div>
        <div class="edit-bar-text">{{ msgPreviewText(replyTo) }}</div>
      </div>
      <div class="edit-bar-close" @click="cancelReply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></div>
    </div>

    <!-- ═══════ @ 提及候选框（内联 · 输入 @ + 关键词实时筛选） ═══════ -->
    <div v-if="mentionPick && !voiceMode" class="mention-panel">
      <div class="mention-list">
        <div v-for="m in mentionCandidates" :key="m.uid || m.name" class="mention-item" @mousedown.prevent @click="selectMention(m)">
          <div class="mention-avatar" :style="m.uid === '__all__' ? 'background:var(--tg-blue)' : { background: avatarColor(m.name) }">{{ m.uid === '__all__' ? '全' : (m.name || '?')[0] }}</div>
          <span class="mention-name">{{ m.name }}</span>
        </div>
        <div v-if="!mentionCandidates.length" class="mention-empty">未找到匹配成员</div>
      </div>
    </div>
    <div v-if="!isDissolved && !channelReadonly" class="input-bar">
      <button class="attach-btn" @click="showAttachSheet = true" title="相册 / 拍摄 / 文件">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button class="attach-btn voice-toggle-btn" :class="{ active: voiceMode }" @click="toggleVoiceMode" title="语音 / 文字切换">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" :stroke="voiceMode ? '#3390EC' : '#707579'" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg>
      </button>
      <input type="file" ref="galleryInput" accept="image/*,video/*" multiple style="display:none" @change="onFilePicked">
      <input type="file" ref="cameraInput" accept="image/*" capture="camera" style="display:none" @change="onFilePicked">
      <input type="file" ref="fileInput" multiple style="display:none" @change="onFilePicked">
      
      <textarea v-if="!voiceMode" class="msg-textarea" ref="msgInput" v-model="draft" rows="1" :placeholder="state.e2eOn ? (state.burnSeconds ? '加密消息 · 阅后即焚' : '加密消息 · 端到端') : (state.burnSeconds ? '消息 · 阅后即焚' : '消息')" @input="onDraftInput" @keydown.enter.exact.prevent="send" @focus="onInputFocus"></textarea>
      <div v-else class="voice-hold" :class="{ cancel: voiceCancelMode }" @touchstart.prevent="voiceStart" @touchend.prevent="voiceEnd" @touchmove="voiceMove" @touchcancel="voiceCancel">按住 说话</div>
      <button class="burn-btn" :class="{ active: state.e2eOn }" @click="toggleE2E" title="明文加密（端到端，仅单聊）">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" :stroke="state.e2eOn ? '#3390EC' : '#707579'" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </button>
      <button class="fire-btn" :class="{ active: state.burnSeconds }" @click="showBurnSheet = true" :title="state.burnSeconds && state.e2eOn ? '阅后即焚 + 明文加密（端到端密文）' : '阅后即焚'">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" :stroke="state.burnSeconds ? '#E07000' : '#707579'" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      </button>
      <button class="send-btn" @mousedown.prevent @click="send">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </div>
    <div v-else-if="isDissolved" class="dissolved-bar">{{ isChannelChat ? '频道' : '群组' }}已解散，无法发送消息</div>
    <div v-else class="dissolved-bar">只有频道作者可以发布消息</div>

    <!-- ═══════ 语音录制浮层：长按录入时居中显示，上滑进入取消区 ═══════ -->
    <div v-if="recording" class="voice-rec-mask">
      <div class="voice-rec-box" :class="{ cancel: voiceCancelMode }">
        <svg class="voice-rec-mic" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg>
        <div class="voice-rec-time">{{ voiceSec }}&#8243;</div>
        <div class="voice-rec-tip">{{ voiceCancelMode ? '松开手指，取消发送' : '上滑取消，松开发送' }}</div>
      </div>
    </div>

    <!-- ═══════ 阅后即焚定时器选择 ═══════ -->
    <div v-if="showBurnSheet" class="overlay" @click.self="showBurnSheet = false">
      <div class="sheet">
        <div class="sheet-title">阅后即焚 · 消息销毁时间</div>
        <div v-for="o in burnOptions" :key="o.v" class="sheet-item" :style="state.burnSeconds === o.v ? 'font-weight:600;background:var(--tg-gray-bg)' : ''" @click="pickBurn(o.v)">
          {{ o.label }}<svg v-if="state.burnSeconds === o.v" class="sheet-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <div class="sheet-item sheet-cancel" @click="showBurnSheet = false">取消</div>
      </div>
    </div>

    <!-- ═══════ 附件选择面板（相册 / 拍摄 / 文件） ═══════ -->
    <div v-if="showAttachSheet" class="overlay" @click.self="showAttachSheet = false">
      <div class="sheet">
        <div class="sheet-title">发送图片或文件</div>
        <div class="attach-grid">
          <div class="attach-item" @click="pickFrom('gallery')">
            <div class="attach-ico" style="background:#2CAF4E"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></div>
            <div class="attach-label">相册</div>
          </div>
          <div class="attach-item" @click="pickFrom('camera')">
            <div class="attach-ico" style="background:#FF9800"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></div>
            <div class="attach-label">拍摄</div>
          </div>
          <div class="attach-item" @click="pickFrom('file')">
            <div class="attach-ico" style="background:#3390EC"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg></div>
            <div class="attach-label">文件</div>
          </div>
        </div>
        <div class="sheet-item sheet-cancel" @click="showAttachSheet = false">取消</div>
      </div>
    </div>



    <!-- ═══════ 待发送文件确认层（多选后确认再发送） ═══════ -->
    <div v-if="showPendingFiles" class="overlay" @click.self="cancelSendFiles">
      <div class="sheet">
        <div class="sheet-title">待发送 {{ pendingFiles.length }} 项</div>
        <div class="pending-list">
          <div v-for="(p, i) in pendingFiles" :key="i" class="pending-row">
            <img v-if="p.url" :src="p.url" class="pending-thumb">
            <div v-else class="pending-thumb pending-fileth"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5aabdf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg></div>
            <div class="pending-meta"><div class="pending-name">{{ p.file.name }}</div><div class="pending-size">{{ fmtSize(p.file.size) }}</div></div>
            <div class="pending-del" @click="removePendingFile(i)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></div>
          </div>
        </div>
        <div class="pending-foot">
          <div class="sheet-item sheet-cancel" @click="cancelSendFiles">取消</div>
          <div class="sheet-item pending-send" :class="{ disabled: sendingFiles }" @click="confirmSendFiles">{{ sendingFiles ? '发送中…' : '发送' }}</div>
        </div>
      </div>
    </div>

    <!-- ═══════ 密钥待办（「稍后处理」收纳的密钥变更） ═══════ -->
    <div v-if="showTofuTodo" class="overlay" @click.self="showTofuTodo = false">
      <div class="sheet">
        <div class="sheet-title">{{ pendingCount ? pendingCount + ' 项密钥待确认' : '密钥待办' }}</div>
        <div class="todo-scroll">
          <div v-if="!pendingCount" class="todo-empty">暂无待处理的密钥变更</div>
          <div v-for="p in pendingList" :key="p.user_id" class="todo-item">
            <div class="todo-item-head">
              <span class="todo-item-name"><svg class="todo-key" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> {{ p.name }}</span>
              <span class="todo-item-time">{{ fmtClock(p.created_at) }}</span>
            </div>
            <div class="todo-item-tip">对方的端到端安全密钥已变更，确认信任后才能继续加密收发</div>
            <div class="todo-item-actions">
              <button class="todo-trust" @click="trustPending(p)">确认信任新密钥</button>
              <button class="todo-ignore" @click="ignorePending(p)">忽略</button>
            </div>
          </div>
        </div>
        <div class="sheet-item sheet-cancel" @click="showTofuTodo = false">关闭</div>
      </div>
    </div>

    <!-- ═══════ 消息操作菜单 ═══════ -->
    <div v-if="msgAction" class="overlay" @click.self="msgAction = null">
      <div class="sheet">
        <div class="sheet-title" style="max-height:60px;overflow:hidden">{{ msgAction.is_recalled ? '消息已撤回' : (msgAction.content || msgAction.file_name || '').slice(0, 60) }}</div>
        <div class="sheet-item" v-if="!msgAction.is_recalled && !channelReadonly" @click="startReply">回复</div>
        <div class="sheet-item" v-if="!msgAction.is_recalled" @click="copyMsg">复制</div>
        <div class="sheet-item" v-if="canEditAction" @click="startEdit">编辑</div>
        <div class="sheet-item" v-if="msgAction.sender_id === state.me.id && !msgAction.is_recalled" @click="showReceipt">已读回执</div>
        <div class="sheet-item danger" v-if="msgAction.sender_id === state.me.id && !msgAction.is_recalled" @click="recallMsg">撤回</div>
        <div class="sheet-item sheet-cancel" @click="msgAction = null">取消</div>
      </div>
    </div>

    <!-- ═══════ 已读回执 ═══════ -->
    <div v-if="receiptMsg" class="overlay" @click.self="receiptMsg = null">
      <div class="sheet">
        <div class="sheet-title">已读回执 · {{ (receiptMsg.content || receiptMsg.file_name || '').slice(0, 30) }}</div>
        <div style="overflow-y:auto">
          <div v-if="receiptLoading" class="sheet-item" style="color:var(--tg-text-secondary)">加载中…</div>
          <template v-else>
            <div v-if="!receiptList.length" class="sheet-item" style="color:var(--tg-text-secondary)">暂无回执数据</div>
            <div v-for="(r, i) in receiptList" :key="r.id || r.user_id || i" class="receipt-row">
              <span>{{ r.user_display_name || '成员' }}</span>
              <span class="receipt-status" :class="{ read: r.is_read }"><template v-if="r.is_read"><svg class="receipt-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l4 4L14 8"/><path d="M10.5 12.5 12.5 14.5 21 6"/></svg>已读</template><template v-else-if="r.is_delivered"><svg class="receipt-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l4 4L14 8"/></svg>已送达</template><template v-else>未送达</template></span>
            </div>
          </template>
        </div>
        <div class="sheet-item sheet-cancel" @click="receiptMsg = null">关闭</div>
      </div>
    </div>

    <!-- 文件在线预览层（Word / Excel / PDF / 文本 / 音视频） -->
    <div v-if="preview.show" class="preview-mask">
      <div class="preview-head">
        <div class="preview-close" @click="closePreview">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </div>
        <div class="preview-title">{{ preview.name }}</div>
        <div class="preview-zoom" v-if="isOfficePreview || preview.kind === 'pdf'">
          <div class="pz-btn" @click="previewZoom(-0.25)">−</div>
          <div class="pz-val">{{ Math.round(preview.zoom * 100) }}%</div>
          <div class="pz-btn" @click="previewZoom(0.25)">＋</div>
        </div>
        <div class="preview-dl" @click="downloadPreview">下载</div>
      </div>
      <div class="preview-body" @dblclick="onPreviewDbl" @touchstart="onPinchStart('preview', $event)" @touchmove="onPinchMove" @touchend="onPinchEnd">
        <div v-if="preview.loading" class="preview-tip">加载中…</div>
        <div v-else-if="preview.error" class="preview-tip">{{ preview.error }}<div><span class="preview-tip-btn" @click="downloadPreview">下载到本地查看</span></div></div>
        <div v-else-if="preview.kind === 'word'" ref="previewBox" class="preview-doc"></div>
        <div v-else-if="preview.kind === 'ppt'" ref="pptBox" class="preview-doc preview-ppt"></div>
        <template v-else-if="preview.kind === 'pdf'">
          <div class="preview-pdf-bar">
            <button class="pdf-nav" :disabled="pdf.page <= 1" @click="pdfGo(pdf.page - 1)">‹ 上一页</button>
            <span class="pdf-page-label">{{ pdf.page }} / {{ pdf.numPages }}</span>
            <button class="pdf-nav" :disabled="pdf.page >= pdf.numPages" @click="pdfGo(pdf.page + 1)">下一页 ›</button>
          </div>
          <div ref="pdfScroll" class="preview-pdf-scroll">
            <canvas ref="pdfCanvas"></canvas>
          </div>
        </template>
        <template v-else-if="preview.kind === 'text'">
          <pre class="preview-text">{{ preview.text }}</pre>
        </template>
        <template v-else-if="preview.kind === 'video'">
          <video class="preview-media" :src="preview.url" controls autoplay playsinline></video>
        </template>
        <template v-else-if="preview.kind === 'audio'">
          <div class="preview-audio"><audio :src="preview.url" controls autoplay playsinline></audio></div>
        </template>
        <template v-else>
          <div v-if="preview.sheets.length > 1" class="preview-sheet-bar">
            <div v-for="(s, i) in preview.sheets" :key="i" class="preview-sheet-tab" :class="{ on: i === preview.activeSheet }" @click="preview.activeSheet = i">{{ s.name }}</div>
          </div>
          <div ref="excelBox" class="preview-doc preview-xlsx" v-html="preview.sheets[preview.activeSheet] ? preview.sheets[preview.activeSheet].html : ''"></div>
        </template>
      </div>
    </div>

    <!-- 图片在线预览层 -->
    <div v-if="viewer.show" class="img-viewer" @click="closeViewer">
      <div class="img-viewer-top">
        <div class="img-viewer-close" @click.stop="closeViewer">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </div>
        <div class="img-viewer-name">{{ viewer.name }}</div>
        <div class="img-viewer-zoom">
          <div class="iz-btn" @click.stop="imgZoom(-0.25)">−</div>
          <div class="iz-val">{{ Math.round(viewer.scale * 100) }}%</div>
          <div class="iz-btn" @click.stop="imgZoom(0.25)">＋</div>
        </div>
        <div class="img-viewer-dl img-viewer-dl-text" @click.stop="downloadViewer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>{{ viewer.saving ? '保存中…' : (viewer.originalUrl ? '下载原图' : '保存到相册') }}
        </div>
      </div>
      <div class="img-viewer-body" @dblclick="imgToggleZoom" @touchstart="imgTouchStart" @touchmove="imgTouchMove" @touchend="imgTouchEnd">
        <img class="img-viewer-img" :src="viewer.url" :style="imgStyle" @click.stop>
      </div>
    </div>
    <!-- 视频播放层：全屏遮罩 + 水平垂直居中撑满播放 + 顶部功能按钮（关闭/名称/下载） -->
    <div v-if="videoViewer.show" class="video-viewer" @click="closeVideoViewer">
      <div class="video-viewer-top">
        <div class="video-viewer-close" @click.stop="closeVideoViewer">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </div>
        <div class="video-viewer-name">{{ videoViewer.name }}</div>
        <div class="video-viewer-dl" @click.stop="downloadVideo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>
        </div>
      </div>
      <div class="video-viewer-body">
        <video class="video-viewer-media" :src="videoViewer.url" controls autoplay playsinline @click.stop></video>
      </div>
    </div>
  </div>
</template>

<script>
import { nextTick, markRaw } from 'vue'
import { state, closeChat, setBurn, sendText, sendFile, sendVoice, recallMessage, revealBurn, showToast, editMessage, openChatInfo, asArray, toggleE2E, confirmPendingKey, ignorePendingKey, confirmTofuKey, dismissTofuAlert, loadMoreMessages, myChatRole } from '../store'
import { api } from '../api'
import { http } from '../utils/request'
import { DEMO } from '../mock/demo'
import { BURN_OPTIONS, avatarColor, avatarSrc, convAvatar, convName, convInitial, fileURL, fmtClock, fmtSize, memberUser, memberUid, memberAvatar, memberName, getFileTypeInfo } from '../utils/format'
import { renderSheetHtml } from '../utils/xlsxRender'
import { copyText } from '../utils/clipboard'
import { Capacitor, registerPlugin } from '@capacitor/core'

// v5.8.8：MediaSaver 原生插件（android/.../MediaSaverPlugin.java）：App 端保存图片走 MediaStore 进系统相册
const MediaSaver = registerPlugin('MediaSaver')

export default {
  name: 'ChatRoom',
  data() {
    return {
      state,
      burnOptions: BURN_OPTIONS,
      draft: '',
      mentionPick: false,   // @ 成员选择器是否打开
      mentionIndex: -1,     // @ 触发位置（待插入处）
      mentionQuery: '',     // @ 后面正在输入的关键词（实时筛选候选成员）
      showBurnSheet: false,
      showAttachSheet: false,
      pendingFiles: [],         // 待发送文件列表：{ file, url }（url 为图片预览 objectURL）
      showPendingFiles: false,  // 待发送确认层开关
      sendingFiles: false,      // 正在发送待发送文件
      showTofuTodo: false,
      msgAction: null,
      editing: null,       // 正在编辑的消息
      replyTo: null,       // 引用回复：正在回复的消息
      replyCache: {},      // 引用快照缓存：reply_to_id -> { name, text }（原文不在当前已加载列表时也能正常显示引用块）
      receiptMsg: null,    // 查看回执的消息
      receiptList: [],
      receiptLoading: false,
      mentionReceipts: {},  // 群 @消息 已读回执缓存：消息 id -> 回执列表（@所有人显示已读头像 / @某人显示对方已读，见 loadMentionReceipts）
      preview: { show: false, kind: '', name: '', url: '', loading: false, error: '', sheets: [], activeSheet: 0, text: '', zoom: 1 }, // 文件在线预览（word/ppt/excel/pdf/text/video/audio）
      pdf: { doc: null, page: 1, numPages: 0, fitScale: 1, rendering: false }, // PDF 预览状态
      viewer: { show: false, url: '', name: '', scale: 1, tx: 0, ty: 0 }, // 图片在线预览（支持缩放/平移）
      videoViewer: { show: false, url: '', name: '' }, // 视频播放层（全屏遮罩 + 居中撑满播放 + 下载）
      imgGesture: null, // 图片查看器手势态（pan/pinch）
      pinch: null, // 文档预览捏合缩放态 { ctx, active, dist, base }
      wordFit: 1, // Word 首屏宽度适配系数（渲染后缓存）
      pptFit: 1,  // PPT 首屏宽度适配系数（渲染后缓存）
      pptViewer: null, // pptx-preview 预览器实例（关闭时销毁）
      stickBottom: true,   // 是否吸附在底部（用户未上滑查看历史时自动跟随新消息）
      newMsgPill: false,   // 上滑看历史期间收到新消息 → 显示「↓ 新消息」浮钮
      reveal: {},          // 端到端加密消息点按显示状态 { msgId: true }
      revealTickers: {},   // 点按显示倒计时定时器 { msgId: intervalId }
      revealLeft: {},      // 点按显示剩余秒数 { msgId: n }
      // ══ 语音消息（V5.8.4）══
      voiceMode: false,        // 语音/文字输入模式（输入框前的麦克风按钮切换）
      recording: false,        // 正在长按录音
      voiceSec: 0,             // 已录秒数（最长 60 自动断）
      voiceCancelMode: false,  // 手指上滑进入取消区
      voiceStartY: 0,          // 录音起始触点 Y（判定上滑距离）
      voiceTimer: null,        // 计秒 interval
      voiceRecorder: null,     // MediaRecorder 实例
      voiceStream: null,       // 麦克风 MediaStream（停录后关轨释放）
      voiceMime: '',           // 实际采用的录音 mimeType（webm/opus 优先）
      playVoiceId: null,       // 正在播放的语音消息 id（气泡动画）
      playVoiceEl: null,       // 单例 audio 播放器（同时只播一条）
      // ══ 会话内消息搜索 ══
      chatSearchOpen: false,
      chatSearchKeyword: '',
      chatSearchResults: [],
      chatSearchLoading: false,
      chatSearchNextBefore: null,
      chatSearchDebounce: null,
      myChannelId: null,       // 「我的频道」id：频道会话打开时拉取，兜底判断当前用户是否为频道作者
    }
  },
  computed: {
    // 当前会话相关的用户 id 集合（私聊=对方，群聊=全体成员）
    chatPeerUids() {
      const c = state.chat
      if (!c) return new Set()
      if (c.type === 'private') {
        const ou = c.other_user
        const oid = ou && (ou.id || ou.user_id)
        return new Set(oid ? [oid] : [])
      }
      return new Set((Array.isArray(state.groupMembers) ? state.groupMembers : []).map(m => memberUid(m)))
    },
    pendingCount() {
      return this.pendingList.length
    },
    pendingList() {
      const uids = this.chatPeerUids
      return Object.values(state.pendingKeyChanges || {})
        .filter(p => uids.has(p.user_id))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    },
    // 当前会话涉及的 TOFU 密钥变更告警
    chatTofuAlerts() {
      const alerts = Array.isArray(state.tofuAlerts) ? state.tofuAlerts : []
      if (!alerts.length) return []
      const uids = this.chatPeerUids
      return alerts.filter(a => uids.has(a.user_id))
    },
    canEditAction() {
      const m = this.msgAction
      return !!(m && m.sender_id === state.me.id && !m.is_recalled && m.type === 'text' && !m.is_encrypted)
    },
    isOfficePreview() {
      return this.preview.kind === 'word' || this.preview.kind === 'excel' || this.preview.kind === 'ppt'
    },
    imgStyle() {
      return { transform: `translate(${this.viewer.tx}px, ${this.viewer.ty}px) scale(${this.viewer.scale})`, transition: 'transform .1s ease-out' }
    },
    // 当前会话是否为频道
    isChannelChat() {
      return !!(state.chat && (state.chat.is_channel || state.chat.type === 'channel'))
    },
    // 当前用户是否为频道作者：会话对象字段 → 成员角色 → 「我的频道」id 三层兜底
    isChannelOwner() {
      if (!this.isChannelChat) return false
      const c = state.chat
      if (c.is_owner === true) return true
      const oid = c.owner_id || (c.owner && (c.owner.id || c.owner.user_id))
      if (oid && String(oid) === String(state.me.id)) return true
      if (myChatRole() === 'owner') return true
      if (this.myChannelId && String(this.myChannelId) === String(c.id)) return true
      return false
    },
    // 频道只读：频道会话且非作者 → 输入栏替换为只读提示
    channelReadonly() {
      return this.isChannelChat && !this.isChannelOwner
    },
    isDissolved() {
      return !!(state.chat && state.chat.dissolved_at)
    },
    mentionMembers() {
      if (!state.chat || state.chat.type === 'private') return []
      const list = Array.isArray(state.groupMembers) ? state.groupMembers : []
      const seen = {}
      const out = []
      for (const m of list) {
        const u = memberUser(m)
        const name = (u && (u.display_name || u.name || u.username || u.nickname || u.phone)) || m.display_name || m.name || ''
        if (!name || seen[name]) continue
        seen[name] = true
        out.push({ uid: memberUid(m), name })
      }
      return out
    },
    // @ 提及候选列表：按 mentionQuery 实时筛选（「所有人」+ 名字匹配的群成员）
    mentionCandidates() {
      const q = (this.mentionQuery || '').trim().toLowerCase()
      const list = []
      if (!q || '所有人'.toLowerCase().includes(q) || 'all'.includes(q)) {
        list.push({ uid: '__all__', name: '所有人', all: true })
      }
      for (const m of this.mentionMembers) {
        if (!q || String(m.name || '').toLowerCase().includes(q)) list.push(m)
      }
      return list
    },
    chatStatus() {
      const c = state.chat
      if (!c) return ''
      if (c.dissolved_at) return '已解散'
      const total = state.groupMembers.length || c.member_count || 0
      if (c.type === 'group') return total + ' 位成员'
      if (c.type === 'channel') return total + ' 位订阅者'
      return '在线'
    },
    burnLabel() {
      const o = BURN_OPTIONS.find(x => x.v === state.burnSeconds)
      return o ? o.label : ''
    }
  },
  watch: {
    // 打开会话/非静默刷新完成 → 重新吸附并强制滚到底部
    'state.msgSeq'() {
      this.loadMentionReceipts()
      const targetId = state.targetMessageId
      if (targetId) {
        state.targetMessageId = null
        this.stickBottom = false
        this.newMsgPill = false
        this.$nextTick(() => {
        this._locating = true
        setTimeout(() => { this._locating = false }, 1200)
        const el = document.getElementById('msg-' + targetId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.remove('highlight')
            void el.offsetWidth
            el.classList.add('highlight')
            setTimeout(() => el.classList.remove('highlight'), 1200)
          } else {
            this.stickBottom = true
            this.scrollBottom()
          }
        })
      } else {
        this.stickBottom = true
        this.newMsgPill = false
        this.scrollBottom()
      }
    },
    // 自己发送/条数变化 → 仅当用户停留在底部（未上滑查看历史）时跟随滚动
    'state.messages.length'() {
      if (this.stickBottom) this.scrollBottom()
    },
    // 切换会话 → 频道会话时拉「我的频道」id，兜底判断作者身份
    'state.chat.id'(id) { this.resolveChannelOwner(id) },
    // 轮询发现新消息（按最新时间戳判定，条数顶到上限不变时也能触发）→ 吸附中滚底，上滑中弹「新消息」浮钮
    'state.newMsgSeq'() {
      if (this.stickBottom) this.scrollBottom()
      else this.newMsgPill = true
    }
  },
  mounted() {
    window.addEventListener('bm-back', this.onNativeBack)
    this.resolveChannelOwner(state.chat && state.chat.id)
    // 键盘遮挡修复（V5.8.4）：软键盘弹出时 visualViewport.height 缩短（AndroidManifest 已配 adjustResize 双保险），
    // 把聊天页高度实时钳制到可视高度 → 输入栏抬到键盘上方、内容区压缩；吸附底部时同步滚到最新
    this.vvResize = () => {
      const vv = window.visualViewport
      if (!vv || !this.$el) return
      this.$el.style.height = Math.round(vv.height) + 'px'
      window.scrollTo(0, 0) // 防 WebView 整页被键盘顶起后漂移
      if (this.stickBottom) this.scrollBottom()
    }
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.vvResize)
    // 群 @消息 已读回执：进聊天页先拉一次，之后每 5s 刷新（别人读到你的 @消息后头像/已读态实时出现）
    this.loadMentionReceipts()
    this._receiptTimer = setInterval(() => { this.loadMentionReceipts() }, 5000)
  },
  beforeUnmount() {
    window.removeEventListener('bm-back', this.onNativeBack)
    if (this._receiptTimer) { clearInterval(this._receiptTimer); this._receiptTimer = null }
    Object.values(this.revealTickers).forEach(clearInterval)
    if (window.visualViewport && this.vvResize) window.visualViewport.removeEventListener('resize', this.vvResize)
    if (this.voiceTimer) clearInterval(this.voiceTimer)
    if (this.voiceStream) { try { this.voiceStream.getTracks().forEach(t => t.stop()) } catch (e) { /* ignore */ } }
    if (this.playVoiceEl) { try { this.playVoiceEl.pause() } catch (e) { /* ignore */ } this.playVoiceEl = null }
  },
  methods: {
    // ══ 会话内消息搜索 ══
    toggleChatSearch() { if (this.chatSearchOpen) { this.closeChatSearch(); return } this.chatSearchOpen = true },
    closeChatSearch() { this.chatSearchOpen = false; this.chatSearchKeyword = ''; this.chatSearchResults = []; this.chatSearchNextBefore = null; this.chatSearchLoading = false; if (this.chatSearchDebounce) { clearTimeout(this.chatSearchDebounce); this.chatSearchDebounce = null } },
    onChatSearchInput() { if (this.chatSearchDebounce) clearTimeout(this.chatSearchDebounce); if (this.chatSearchKeyword.trim().length < 2) { this.chatSearchResults = []; this.chatSearchNextBefore = null; return } this.chatSearchDebounce = setTimeout(() => { this.doChatSearch(false) }, 400) },
    async doChatSearch(loadMore) { if (!state.chat || !state.chat.id) return; const kw = this.chatSearchKeyword.trim(); if (kw.length < 2) return; this.chatSearchLoading = true; try { const params = { keyword: kw, limit: 50 }; if (loadMore && this.chatSearchNextBefore) params.before = this.chatSearchNextBefore; const res = await api.searchConversationMessages(state.chat.id, params); const items = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : (res && res.data && Array.isArray(res.data.items) ? res.data.items : null)); if (items) { if (loadMore) { this.chatSearchResults = this.chatSearchResults.concat(items) } else { this.chatSearchResults = items } if (items.length > 0) { this.chatSearchNextBefore = items[items.length - 1].id } else { this.chatSearchNextBefore = null } } } catch (e) { /* ignore */ } this.chatSearchLoading = false },
    onSearchScroll(e) { const el = e.target; if (this.chatSearchLoading || !this.chatSearchNextBefore) return; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) { this.doChatSearch(true) } },
    onSearchResultClick(m) { this.closeChatSearch(); this.$nextTick(() => { const el = document.getElementById('msg-' + m.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 2000) } }) },
    highlightKeyword(text, kw) { if (!kw || kw.length < 2 || !text) return text || ''; const kwL = kw.toLowerCase(); const txt = String(text); const out = []; let last = 0; let idx = txt.toLowerCase().indexOf(kwL); while (idx !== -1) { out.push(this.escapeHtml(txt.slice(last, idx))); out.push('<mark class="csi-hl">'); out.push(this.escapeHtml(txt.slice(idx, idx + kw.length))); out.push('</mark>'); last = idx + kw.length; idx = txt.toLowerCase().indexOf(kwL, last) } out.push(this.escapeHtml(txt.slice(last))); return out.join('') },
    fmtSearchTime(iso) { if (!iso) return ''; const d = new Date(iso); const now = new Date(); const pad = n => String(n).padStart(2, '0'); const time = pad(d.getHours()) + ':' + pad(d.getMinutes()); if (d.toDateString() === now.toDateString()) return time; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time },
    /** 原生返回键：先关本页内部弹层（回执详情→消息菜单→阅后即焚面板→退出编辑态），消费掉事件 */
    onNativeBack(e) {
      if (this.viewer.show)       { this.closeViewer(); e.preventDefault(); return }
      if (this.videoViewer.show)  { this.closeVideoViewer(); e.preventDefault(); return }
      if (this.preview.show)      { this.closePreview(); e.preventDefault(); return }
      if (this.receiptMsg)        { this.receiptMsg = null; e.preventDefault(); return }
      if (this.msgAction)         { this.msgAction = null; e.preventDefault(); return }
      if (this.showBurnSheet)     { this.showBurnSheet = false; e.preventDefault(); return }
      if (this.showTofuTodo)      { this.showTofuTodo = false; e.preventDefault(); return }
      if (this.showAttachSheet)   { this.showAttachSheet = false; e.preventDefault(); return }
      if (this.editing)           { this.editing = null; e.preventDefault(); return }
      if (this.mentionPick) { this.closeMention(); e.preventDefault(); return }
      if (this.replyTo)       { this.replyTo = null; e.preventDefault(); return }
    },
    /** 频道作者身份兜底：会话对象未带 owner 字段时，拉「我的频道」比对 id */
    async resolveChannelOwner(id) {
      this.myChannelId = null
      if (!id || !this.isChannelChat) return
      const c = state.chat
      if (!c || String(c.id) !== String(id)) return
      if (c.is_owner === true || c.owner_id || c.owner) return
      try {
        const mine = await api.getMyChannel()
        this.myChannelId = mine && mine.id ? String(mine.id) : ''
      } catch (e) { this.myChannelId = '' }
    },
    pickFrom(kind) {
      this.showAttachSheet = false
      nextTick(() => {
        const refs = { gallery: 'galleryInput', camera: 'cameraInput', file: 'fileInput' }
        const el = this.$refs[refs[kind]]
        if (el) el.click()
      })
    },
    trustPending(p) {
      confirmPendingKey(p.user_id)
    },
    ignorePending(p) {
      ignorePendingKey(p.user_id)
    },
    closeChat,
    toggleE2E,
    confirmTofuKey,
    dismissTofuAlert,
    avatarColor,
    convName,
    convInitial,
    convAvatar,
    fileURL,
    fmtClock,
    fmtSize,
    /** 文件消息图标信息：角标文字 + 图标底色 */
    fileTypeInfo(m) {
      const info = getFileTypeInfo(m && m.file_name)
      return {
        label: info.label,
        bgColor: info.bg,
        cat: info.cat
      }
    },
/** 发送者用户对象：通讯录 → 会话对方 → 群成员（兼容嵌套/平铺）→ 演示数据 */
    senderInfo(m) {
      if (m.sender_id === state.me.id) return state.me
      const c = state.contacts.find(x => x.id === m.sender_id)
      if (c) return c
      const ou = state.chat && state.chat.other_user
      if (ou && ou.id === m.sender_id) return ou
      const gm = (Array.isArray(state.groupMembers) ? state.groupMembers : []).find(x => memberUid(x) === m.sender_id)
      if (gm) return memberUser(gm)
      if (state.demoMode) {
        const u = DEMO.users.find(x => x.id === m.sender_id)
        if (u) return u
      }
      return null
    },
    senderName(m) {
      if (m.sender_id === state.me.id) return state.me.display_name || '我'
      const u = this.senderInfo(m)
      return u ? (u.display_name || u.name || u.username || '成员') : '成员'
    },
    senderAvatar(m) {
      return avatarSrc(this.senderInfo(m))
    },
    burnCountdown(m) {
      // 本地倒计时优先：reveal / 历史加载时由后端 remain_seconds 种入 store.burnLeft，摆脱客户端-服务端时钟偏差（10 秒变 20 秒根因）
      const local = (m.id != null) ? state.burnLeft[m.id] : undefined
      if (local != null) return local <= 0 ? '已焚毁' : this.fmtBurnLeft(local)
      // 兜底：demo / 旧数据 / 未点开但已有截止时间，用 burn_at（个人截止）或 destroy_at 绝对时间
      const endStr = m.burn_at || m.destroy_at
      if (!endStr) return ''
      const left = Math.max(0, new Date(endStr) - state.nowTick)
      if (left <= 0) {
        return '已焚毁'
      }
      return this.fmtBurnLeft(Math.ceil(left / 1000))
    },
    fmtBurnLeft(s) {
      if (s < 60) return s + 's 后焚毁'
      if (s < 3600) return Math.ceil(s / 60) + 'min 后焚毁'
      if (s < 86400) return Math.ceil(s / 3600) + 'h 后焚毁'
      return Math.ceil(s / 86400) + 'd 后焚毁'
    },
    /** 是否焚毁消息（burn_ttl_seconds 或 destroy_at 任一即视为焚毁消息） */
    isBurnMsg(m) {
      return !!(m && (m.burn_ttl_seconds != null || m.destroy_at != null))
    },
    /** 是否已焚毁：倒计时归零后保留「已焚毁」占位（类似撤回），不再显示正文/倒计时 */
    isBurned(m) {
      if (!m) return false
      if (m.is_burned === true) return true
      const local = (m.id != null) ? state.burnLeft[m.id] : undefined
      if (local != null) return local <= 0
      const endStr = m.burn_at || m.destroy_at
      if (!endStr) return false
      return new Date(endStr).getTime() <= state.nowTick
    },
    /** 焚毁消息的「马赛克占位」态：点开前，点击触发 reveal 拉取内容 */
    isBlurredBurn(m) {
      return !!(m && m.is_blurred === true)
    },
    /** 焚毁占位卡的消息类型名：文字=消息，其余按 type / 扩展名细分（视频走扩展名，不占位态的 isVideoMsg 会排除模糊态不能直接复用） */
    burnBlurType(m) {
      if (!m) return '消息'
      if (m.type === 'image') return '图片'
      if (m.type === 'voice') return '语音'
      if (m.type === 'video') return '视频'
      if (m.type === 'file') {
        const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
        if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', '3gp'].includes(ext)) return '视频'
        return '文件'
      }
      return '消息'
    },
    /** 焚毁占位卡文案：是否加密 × 消息类型，如「焚毁加密文件 · 点击查看」 */
    burnBlurText(m) {
      return (this.isEnc(m) ? '焚毁加密' : '焚毁') + this.burnBlurType(m) + ' · 点击查看'
    },
    /** 是否显示焚毁倒计时角标：非撤回、已点开（非占位）、且有截止时间 */
    burnVisible(m) {
      return !!(m && !m.is_recalled && !this.isBurned(m) && !m.is_blurred && (m.burn_at || m.destroy_at))
    },
    autoGrow(e) {
      const el = e.target
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    },
    onDraftInput(e) {
      this.autoGrow(e)
      this.computeMentionFromDraft()
    },

    computeMentionFromDraft() {
      // 实时检测「正在输入 @提及」：从光标向前找最近一个有效 @，提取其后关键词；无有效 @ 或已含空白则收起候选框
      if (!state.chat || state.chat.type === 'private') { this.closeMention(); return }
      const el = this.$refs.msgInput
      if (!el) return
      const pos = el.selectionStart
      const before = this.draft.slice(0, pos)
      const lastAt = before.lastIndexOf('@')
      if (lastAt < 0) { this.closeMention(); return }
      const prev = before.slice(0, lastAt).slice(-1)
      if (lastAt !== 0 && !/\s/.test(prev)) { this.closeMention(); return }
      const query = before.slice(lastAt + 1)
      if (/\s/.test(query)) { this.closeMention(); return }
      this.mentionIndex = lastAt
      this.mentionQuery = query
      this.mentionPick = true
    },

    selectMention(m) {
      const name = (m && m.name) || ''
      const atIdx = this.mentionIndex
      const _el0 = this.$refs.msgInput
      const cursor = _el0 ? _el0.selectionStart : this.draft.length
      this.closeMention()
      if (!name) return
      const start = (atIdx >= 0 && atIdx <= this.draft.length) ? atIdx : 0
      const end = Math.max(cursor, start)
      const insert = '@' + name + ' '
      this.draft = this.draft.slice(0, start) + insert + this.draft.slice(end)
      const p = start + insert.length
      nextTick(() => {
        const el2 = this.$refs.msgInput
        if (!el2) return
        el2.focus()
        el2.setSelectionRange(p, p)
        el2.style.height = 'auto'
        el2.style.height = Math.min(el2.scrollHeight, 120) + 'px'
      })
    },
    closeMention() {
      this.mentionPick = false
      this.mentionIndex = -1
      this.mentionQuery = ''
    },
    /** 长按/右键群员头像：@ 该发件人（提取其显示名插入草稿） */
    mentionSender(m) {
      const now = Date.now()
      if (now - (this._lastMentionAt || 0) < 800) return
      this._lastMentionAt = now
      if (!state.chat || state.chat.type === 'private') return
      const u = this.senderInfo(m)
      const name = u ? (u.display_name || u.name || u.username || u.nickname || '') : (m && (m.sender_name || ''))
      if (!name) return
      const el = this.$refs.msgInput
      const pos = el ? el.selectionStart : this.draft.length
      const insert = '@' + name + ' '
      const before = this.draft.slice(0, pos)
      const after = this.draft.slice(pos + (this.draft.slice(pos).startsWith('@') ? 1 : 0))
      this.draft = before + insert + after
      this.closeMention()
      nextTick(() => {
        const el2 = this.$refs.msgInput
        if (!el2) return
        const p = pos + insert.length
        if (window.getSelection) window.getSelection().removeAllRanges()
        // 长按@不自动聚焦：避免移动端软键盘弹出遮挡页面、锁住交互
        
      })
    },
    mentionPressStart(e, m) {
      if (!m || m.sender_id === state.me.id || !state.chat || state.chat.type === 'private') return
      this._mp = { m, x: e.touches[0].clientX, y: e.touches[0].clientY, fired: false }
      this._mpTimer = setTimeout(() => {
        if (this._mp && this._mp.m === m) { this._mp.fired = true; this.mentionSender(m) }
      }, 500)
    },
    mentionPressEnd() {
      clearTimeout(this._mpTimer); this._mp = null
    },
    mentionPressCancel() {
      clearTimeout(this._mpTimer); this._mp = null
    },
    escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    },
    mentionNames() {
      const s = new Set(['所有人'])
      this.mentionMembers.forEach(m => m.name && s.add(m.name))
      return Array.from(s).sort((a, b) => b.length - a.length)
    },
    isMyName(name) {
      const me = state.me || {}
      return !!name && [me.display_name, me.name, me.username, me.nickname].filter(Boolean).includes(name)
    },
    renderMentionHtml(text) {
      if (!text) return ''
      const esc = this.escapeHtml(String(text))
      if (!state.chat || state.chat.type === 'private') return esc
      const names = this.mentionNames()
      if (!names.length) return esc
      return esc.replace(/@[^\s@，。,.!?！？:：;；、"'（）()[\]<>]+/g, whole => {
        const name = whole.slice(1)
        if (!names.includes(name)) return whole
        const cls = this.isMyName(name) ? 'mention mention-me' : 'mention'
        return '<span class="' + cls + '">' + whole + '</span>'
      })
    },
    extractMentions(text) {
      if (!text || !state.chat || state.chat.type === 'private') return []
      const ids = []
      const seen = {}
      // 长名优先，避免「李四」误匹配到「李四丰」这类前缀
      const members = [...this.mentionMembers].sort((a, b) => String(b.name).length - String(a.name).length)
      for (const m of members) {
        if (m.uid == null || seen[m.uid]) continue
        const re = new RegExp('@' + String(m.name).replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch) + '(?![\\w\\u4e00-\\u9fa5])')
        if (re.test(text)) { seen[m.uid] = true; ids.push(m.uid) }
      }
      return ids
    },
    onMsgScroll() {
      const b = this.$refs.msgBox
      if (!b) return
      // 距底部 < 60px 视为「在底部」：恢复自动跟随并收起新消息浮钮；否则用户正在上滑查看历史，停止跟随
      const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 60
      this.stickBottom = atBottom
      if (atBottom) this.newMsgPill = false
      // 滚到顶部附近 → 触发加载更早历史（还有更多、且未在加载时才拉）
      if (b.scrollTop < 40 && state.hasMore && !state.loadingEarlier && !state.msgLoading && !this._locating) this.loadEarlier()
    },
    /** 向上加载更早历史：记录加载前滚动高度，插入后把 scrollTop 补回，避免可视区跳动 */
    async loadEarlier() {
      const b = this.$refs.msgBox
      const prevHeight = b ? b.scrollHeight : 0
      const prevTop = b ? b.scrollTop : 0
      await loadMoreMessages()
      nextTick(() => {
        const b2 = this.$refs.msgBox
        if (b2) {
          const delta = b2.scrollHeight - prevHeight
          if (delta > 0) b2.scrollTop = prevTop + delta
        }
      })
    },
    scrollBottom() {
      nextTick(() => {
        const b = this.$refs.msgBox
        if (b && this.stickBottom) b.scrollTop = b.scrollHeight
        // 再补一帧校准：仅在吸附状态下二次滚底，避免打扰上滑看历史的用户
        requestAnimationFrame(() => {
          const b2 = this.$refs.msgBox
          if (b2 && this.stickBottom) b2.scrollTop = b2.scrollHeight
        })
      })
    },
    /** 点击「↓ 新消息」浮钮：强制吸附并滚到最新 */
    jumpToLatest() {
      this.newMsgPill = false
      this.stickBottom = true
      this.scrollBottom()
    },
    /** 消息渲染 key 兜底：id → message_id → 索引，避免后端 id 字段名不一致导致 key 冲突、新行不渲染 */
    msgKey(m, i) {
      return (m && (m.id ?? m.message_id ?? m.messageId)) ?? i
    },
    /** 本人私聊消息是否被对方已读：消息时间 ≤ 已读水位线（真实回执数据，store 维护） */
    isPeerRead(m) {
      if (this.state.demoMode) return true // 演示模式统一显示已读
      const t = Date.parse((m && m.created_at) || '') || 0
      return t > 0 && t <= this.state.readWatermark
    },
    pickBurn(v) {
      setBurn(v)
      this.showBurnSheet = false
    },
    openInfo() {
      openChatInfo()
    },
    startEdit() {
      const m = this.msgAction
      this.msgAction = null
      this.editing = m
      this.draft = m.content || ''
      nextTick(() => { if (this.$refs.msgInput) this.$refs.msgInput.focus() })
    },
    cancelEdit() {
      this.editing = null
      this.draft = ''
    },
    startReply() {
      const m = this.msgAction
      this.msgAction = null
      // 若正处在编辑态，切到回复态前先退出编辑
      if (this.editing && !this.draft.trim()) this.editing = null
      // 立即缓存被回复原文的快照：即使后续切分页/原文被焚毁移除，引用块也能正常显示摘要
      if (m && m.id != null) this.replyCache[String(m.id)] = { name: this.senderName(m), text: this.msgPreviewText(m) }
      this.replyTo = m
      nextTick(() => { if (this.$refs.msgInput) this.$refs.msgInput.focus() })
    },
    cancelReply() {
      this.replyTo = null
    },
    /** 在当前会话消息里定位一条消息（供回复引用展示与被回复跳转） */
    findMessage(id) {
      if (id == null) return null
      const s = String(id)
      const hit = state.messages.find(x => String(x.id ?? x.message_id ?? x.messageId) === s)
      if (hit) return hit
      const arr = state.chat && DEMO.messages[state.chat.id]
      if (Array.isArray(arr)) return arr.find(x => String(x.id) === s) || null
      return null
    },
    /** 一条消息自身的摘要文本（媒体/已焚毁/已撤回做占位），不依赖 reply_to_id 反查 */
    msgPreviewText(t) {
      if (!t || typeof t !== 'object') return ''
      if (t.is_recalled) return '此消息已撤回'
      if (this.isBurned(t)) return '此消息已焚毁'
      if (t.type === 'image') return '[图片]' + (t.content ? ' ' + t.content : '')
      if (t.type === 'file') return '[文件] ' + (t.file_name || '')
      if (t.type === 'voice') return '[语音]' + (/^\d+$/.test(t.content || '') ? ` ${t.content}″` : '')
      if (t.type === 'video') return '[视频]'
      return (t.content || '').replace(/\n/g, ' ').slice(0, 60)
    },
    /** 回复者显示名（引用条/气泡引用块的标题）：先读快照，再回退当前列表 */
    replyName(m) {
      const id = m && m.reply_to_id
      if (id != null && this.replyCache[String(id)]) return this.replyCache[String(id)].name
      const target = this.findMessage(id)
      return target ? this.senderName(target) : ''
    },
    /** 被回复消息的摘录文本：先读快照，再回退当前列表 */
    replyText(m) {
      const id = m && m.reply_to_id
      if (id != null && this.replyCache[String(id)]) return this.replyCache[String(id)].text
      const target = this.findMessage(id)
      if (!target) return ''
      return this.msgPreviewText(target)
    },
    /** 气泡内引用块：有 reply_to_id → 返回 { name, text }；原文与快照都拿不到时返回 null（不渲染空引用块） */
    replyQuote(m) {
      if (!m || m.reply_to_id == null) return null
      const name = this.replyName(m)
      const text = this.replyText(m)
      if (!name && !text) return null
      return { name, text }
    },
    /** 点击气泡引用块：滚动并高亮被回复消息 */
    async jumpToReply(m) {
      const target = this.findMessage(m && m.reply_to_id)
      if (!target) { showToast('原消息不可用'); return }
      const box = this.$refs.msgBox
      await nextTick()
      const idx = state.messages.indexOf(target)
      const el = box && box.querySelectorAll('.msg-row')[idx]
      if (!el) { this.scrollBottom(); return }
      const wasAtBottom = this.stickBottom
      const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
      box.scrollTop = Math.max(0, top)
      this.stickBottom = wasAtBottom && (box.scrollHeight - box.scrollTop - box.clientHeight < 60)
      // 高亮闪烁
      el.classList.add('highlight')
      clearTimeout(this._hlTimer)
      this._hlTimer = setTimeout(() => el.classList.remove('highlight'), 1200)
    },
    async showReceipt() {
      const m = this.msgAction
      this.msgAction = null
      this.receiptMsg = m
      this.receiptList = []
      this.receiptLoading = true
      if (state.demoMode) {
        const others = state.chat && state.chat.type === 'private'
          ? [state.chat.other_user].filter(Boolean)
          : DEMO.users.slice(0, 3)
        this.receiptList = others.map((u, i) => ({
          user_id: u.id, user_display_name: u.display_name,
          is_delivered: true, is_read: i < 2, read_at: i < 2 ? new Date().toISOString() : null
        }))
        this.receiptLoading = false
        return
      }
      try {
        this.receiptList = asArray(await api.getReceipt(m.id))
      } catch (e) {
        showToast(e.message)
        this.receiptMsg = null
      } finally {
        this.receiptLoading = false
      }
    },
    async send() {
      const text = this.draft.trim()
      if (!text) return
      try {
        // 编辑模式：提交修改
      if (this.editing) {
        const m = this.editing
        if (text === (m.content || '').trim()) { this.cancelEdit(); return }
        this.editing = null
        this.draft = ''
        if (this.$refs.msgInput) this.$refs.msgInput.style.height = 'auto'
        const ok = await editMessage(m, text)
        if (!ok) { this.editing = m; this.draft = text }
        return
      }
      if (!state.chat) return
      const replyId = this.replyTo ? (this.replyTo.id ?? this.replyTo.message_id) : null
      this.draft = ''
      this.replyTo = null
      if (this.$refs.msgInput) this.$refs.msgInput.style.height = 'auto'
      const ok = await sendText(text, this.extractMentions(text), replyId)
      if (!ok) this.draft = text
      else this.loadMentionReceipts()
      } finally {
        // 发送后保持键盘，避免移动端按钮点击收起软键盘
        nextTick(() => { if (this.$refs.msgInput) this.$refs.msgInput.focus() })
      }
    },
    onFilePicked(e) {
      const files = Array.from(e.target.files || [])
      e.target.value = ''
      if (!files.length) return
      for (const f of files) {
        if (f.size > 50 * 1024 * 1024) { showToast('「' + f.name + '」超过 50MB，已跳过'); continue }
        this.pendingFiles.push({ file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null })
      }
      if (this.pendingFiles.length) this.showPendingFiles = true
    },
    /** 移除待发送列表中的某一项（回收预览 objectURL） */
    removePendingFile(i) {
      const p = this.pendingFiles[i]
      if (p && p.url) URL.revokeObjectURL(p.url)
      this.pendingFiles.splice(i, 1)
      if (!this.pendingFiles.length) this.cancelSendFiles()
    },
    /** 取消发送：清空待发送列表并回收预览 */
    cancelSendFiles() {
      this.pendingFiles.forEach(p => { if (p.url) URL.revokeObjectURL(p.url) })
      this.pendingFiles = []
      this.showPendingFiles = false
      this.sendingFiles = false
    },
    /** 确认发送：逐张上传发送（单张失败不阻断后续，sendFile 内部各自 toast） */
    async confirmSendFiles() {
      if (this.sendingFiles) return
      const list = this.pendingFiles.slice()
      this.sendingFiles = true
      for (const p of list) await sendFile(p.file)
      list.forEach(p => { if (p.url) URL.revokeObjectURL(p.url) })
      this.pendingFiles = []
      this.showPendingFiles = false
      this.sendingFiles = false
    },
    // ═══════ 语音消息：模式切换 / 长按录音 / 上滑取消 / 点击播放 ═══════
    /** 麦克风按钮：语音/文字输入切换（录音进行中不响应） */
    toggleVoiceMode() {
      if (this.recording) return
      this.voiceMode = !this.voiceMode
    },
    /** 长按开始录音：getUserMedia 取麦克风流 → MediaRecorder 录 webm/opus（不支持时回退 mp4） */
    async voiceStart(e) {
      if (this.recording) return
      if (!state.chat) return
      if (state.demoMode) { showToast('演示模式暂不支持语音'); return }
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) { showToast('当前环境不支持录音'); return }
      const touch = e.touches && e.touches[0]
      this.voiceStartY = touch ? touch.clientY : 0
      this.voiceCancelMode = false
      this.voiceSec = 0
      this._voiceChunks = []
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        this.voiceStream = stream
        const cand = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        this.voiceMime = cand.find(t => MediaRecorder.isTypeSupported(t)) || ''
        const rec = this.voiceMime ? new MediaRecorder(stream, { mimeType: this.voiceMime }) : new MediaRecorder(stream)
        rec.ondataavailable = ev => { if (ev.data && ev.data.size) this._voiceChunks.push(ev.data) }
        rec.start(250) // 250ms 切片，停止时最多丢 0.25s 尾音
        this.voiceRecorder = rec
        this.recording = true
        this.voiceTimer = setInterval(() => { if (++this.voiceSec >= 60) this.voiceEnd() }, 1000) // 60 秒自动结束并发送
      } catch (err) {
        this.voiceCleanup()
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
        showToast(denied ? '麦克风权限被拒绝：请到 系统设置 → 应用 → 焚信 → 权限 → 允许麦克风' : '录音启动失败：' + ((err && err.message) || err))
      }
    },
    /** 录音中移动手指：上滑超过 50px 进入取消区（滑回可恢复） */
    voiceMove(e) {
      if (!this.recording) return
      const touch = e.touches && e.touches[0]
      if (touch) this.voiceCancelMode = (this.voiceStartY - touch.clientY) > 50
    },
    /** 松开手指：上滑状态丢弃，正常状态上传发送；短于 1 秒提示太短 */
    voiceEnd() {
      if (!this.recording) return
      const sec = this.voiceSec
      const cancel = this.voiceCancelMode
      const rec = this.voiceRecorder
      const mime = this.voiceMime
      this.recording = false
      this.voiceCancelMode = false
      if (this.voiceTimer) { clearInterval(this.voiceTimer); this.voiceTimer = null }
      if (!rec || rec.state === 'inactive') { this.voiceCleanup(); return }
      rec.onstop = () => {
        const blob = new Blob(this._voiceChunks || [], { type: mime || 'audio/webm' })
        this.voiceCleanup()
        if (cancel) return
        if (sec < 1) { showToast('说话时间太短'); return }
        const ext = mime && mime.includes('mp4') ? 'm4a' : 'webm'
        sendVoice(new File([blob], `语音_${Date.now()}.${ext}`, { type: blob.type }), sec)
      }
      try { rec.stop() } catch (e2) { this.voiceCleanup() }
    },
    /** 系统打断（来电/切后台等 touchcancel）：直接丢弃 */
    voiceCancel() {
      if (!this.recording) return
      const rec = this.voiceRecorder
      this.recording = false
      if (this.voiceTimer) { clearInterval(this.voiceTimer); this.voiceTimer = null }
      this.voiceCancelMode = false
      if (rec && rec.state !== 'inactive') { try { rec.onstop = null; rec.stop() } catch (e) { /* ignore */ } }
      this.voiceCleanup()
      showToast('录音已取消')
    },
    /** 释放麦克风轨道，复位录音态 */
    voiceCleanup() {
      if (this.voiceStream) { try { this.voiceStream.getTracks().forEach(t => t.stop()) } catch (e) { /* ignore */ } this.voiceStream = null }
      this.voiceRecorder = null
      this.voiceSec = 0
    },
    /** 点击语音气泡：单实例播放器，再点同一条停止，点另一条切换 */
    togglePlayVoice(m) {
      if (!m || !m.file_url) return
      if (!this.playVoiceEl) {
        this.playVoiceEl = new Audio()
        this.playVoiceEl.addEventListener('ended', () => { this.playVoiceId = null })
      }
      const a = this.playVoiceEl
      if (this.playVoiceId === m.id) {
        try { a.pause(); a.currentTime = 0 } catch (e) { /* ignore */ }
        this.playVoiceId = null
      } else {
        try { a.pause() } catch (e) { /* ignore */ }
        a.src = fileURL(m.file_url)
        a.currentTime = 0
        this.playVoiceId = m.id
        a.play().catch(() => { this.playVoiceId = null; showToast('语音播放失败') })
      }
    },
    /** 语音时长（秒）：约定 voice 消息 content 存纯数字字符串 */
    voiceDur(m) {
      const n = parseInt(m && m.content, 10)
      return Number.isFinite(n) && n > 0 ? n : 0
    },
    /** 气泡宽度按时长微调（1~60s → 88~228px，微信风格） */
    voiceBarWidth(m) {
      return Math.round(88 + Math.min(this.voiceDur(m), 60) / 60 * 140) + 'px'
    },
    /** 输入框聚焦（键盘弹起）兜底滚底：仅吸附底部时跟随，不打扰上滑看历史的用户 */
    onInputFocus() {
      if (this.stickBottom) this.scrollBottom()
    },
    /** 点击文件消息：按扩展名路由到对应在线预览（Word/Excel/PDF/文本/图片/音视频），未知类型回退下载 */
    openFile(m) {
      if (!m.file_url) return
      const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
      if (ext === 'docx') this.startPreview(m, 'word')
      else if (ext === 'pptx' || ext === 'ppt') this.startPreview(m, 'ppt')
      else if (ext === 'xlsx' || ext === 'xls') this.startPreview(m, 'excel')
      else if (ext === 'pdf') this.startPreview(m, 'pdf')
      else if (['txt', 'md', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'sql', 'sh', 'bat', 'js', 'ts', 'html', 'css'].includes(ext)) this.startPreview(m, 'text')
      else if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', '3gp'].includes(ext)) this.openVideo(m)
      else if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'amr'].includes(ext)) this.startPreview(m, 'audio')
      else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) this.startPreview(m, 'image')
      else window.open(fileURL(m.file_url), '_blank')
    },
    /** 在线预览：拉取文件 blob → docx-preview 渲染 Word / SheetJS 渲染 Excel / pdf.js 渲染 PDF / 文本 / 原生音视频（库均按需动态加载，不进主包） */
    async startPreview(m, kind) {
      if (kind === 'image') { this.openImageView(m); return } // 图片直接走大图查看器
      this.preview = { show: true, kind, name: m.file_name || '附件', url: fileURL(m.file_url), loading: true, error: '', sheets: [], activeSheet: 0, text: '', zoom: 1 }
      if (kind === 'video' || kind === 'audio') { this.preview.loading = false; return } // 音视频用原生播放器直连
      if (state.demoMode) { this.preview.loading = false; this.preview.error = '演示模式暂不支持在线预览'; return }
      let blob
      try {
        blob = await http.get(this.preview.url, { responseType: 'blob', timeout: 60000 })
      } catch (e) {
        this.preview.loading = false
        this.preview.error = '文件获取失败'
        return
      }
      try {
        if (kind === 'word') {
          const { renderAsync } = await import('docx-preview')
          this.preview.loading = false
          await nextTick()
          await renderAsync(blob, this.$refs.previewBox, null, { inWrapper: true, breakPages: true })
          // 缓存首屏宽度适配系数，缩放时在 fit 基础上叠加用户 zoom
          const box = this.$refs.previewBox
          const sec = box ? box.querySelector('section.docx') : null
          const cw = box ? box.clientWidth : 0
          this.wordFit = (sec && cw > 0 && sec.offsetWidth > cw) ? cw / sec.offsetWidth : 1
          this.applyWordZoom()
        } else if (kind === 'ppt') {
          const { init } = await import('pptx-preview')
          this.preview.loading = false
          await nextTick()
          const buffer = await blob.arrayBuffer()
          this.pptViewer = init(this.$refs.pptBox, { width: this.$refs.pptBox.clientWidth || 720, mode: 'list' })
          await this.pptViewer.preview(buffer)
          const box = this.$refs.pptBox
          const slide = box ? box.querySelector('.pptx-preview-slide-wrapper') : null
          const cw = box ? box.clientWidth : 0
          this.pptFit = (slide && cw > 0 && slide.offsetWidth > cw) ? cw / slide.offsetWidth : 1
          this.applyPptZoom()
        } else if (kind === 'pdf') {
          await this.openPdf(blob)
        } else if (kind === 'text') {
          this.preview.text = await blob.text()
          this.preview.loading = false
        } else {
          const buf = await blob.arrayBuffer()
          const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
          if (ext === 'xlsx') {
            // xlsx：exceljs 读取样式，自渲染还原原生 Excel 观感（颜色/边框/合并/列宽行高/数字格式）
            const ExcelJS = await import('exceljs')
            const wb = new ExcelJS.Workbook()
            await wb.xlsx.load(buf)
            this.preview.sheets = wb.worksheets.map(ws => ({ name: ws.name, html: renderSheetHtml(ws) }))
          } else {
            // xls 老格式：SheetJS 兜底（无样式，数据+网格线）
            const XLSX = await import('xlsx')
            const wb = XLSX.read(buf, { type: 'array' })
            this.preview.sheets = wb.SheetNames.map(n => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n]) }))
          }
          if (!this.preview.sheets.length) throw new Error('empty workbook')
          this.preview.loading = false
          await nextTick()
          this.applyExcelZoom()
        }
      } catch (e) {
        console.warn('[preview] render fail', e)
        this.preview.loading = false
        this.preview.error = '该文件无法预览'
      }
    },
/** PDF 预览：pdf.js 绘制到 canvas（跨平台，Android WebView 亦可用），支持翻页与缩放 */
    async openPdf(blob) {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      const buf = await blob.arrayBuffer()
      const docBase = document.baseURI || location.href
      const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: new URL('pdfjs/cmaps/', docBase).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('pdfjs/standard_fonts/', docBase).href,
        isEvalSupported: false
      }).promise
      this.pdf = { doc: markRaw(doc), page: 1, numPages: doc.numPages, fitScale: 1, rendering: false }
      const first = await doc.getPage(1)
      const base = first.getViewport({ scale: 1 })
      const scroll = this.$refs.pdfScroll
      const cw = scroll ? scroll.clientWidth : 0
      this.pdf.fitScale = cw > 0 ? Math.min(3, cw / base.width) : 1
      this.preview.loading = false
      await nextTick()
      await this.renderPdfPage()
    },
    async renderPdfPage() {
      const doc = this.pdf.doc
      const canvas = this.$refs.pdfCanvas
      if (!doc || !canvas) return
      if (this.pdf.rendering) { this.pdf._rerender = true; return } // 合并高频缩放请求
      this.pdf.rendering = true
      try {
        const page = await doc.getPage(this.pdf.page)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const scale = this.pdf.fitScale * (this.preview.zoom || 1) * dpr
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = Math.floor(viewport.width / dpr) + 'px'
        canvas.style.height = Math.floor(viewport.height / dpr) + 'px'
        const ctx = canvas.getContext('2d')
        await page.render({ canvasContext: ctx, viewport }).promise
      } catch (e) {
        console.error('[pdf] render fail', e)
        this.preview.error = 'PDF 渲染失败：' + (e && e.message ? e.message : String(e))
      } finally {
        this.pdf.rendering = false
        if (this.pdf._rerender) { this.pdf._rerender = false; this.renderPdfPage() }
      }
    },
    async pdfGo(p) {
      if (!this.pdf.doc || p < 1 || p > this.pdf.numPages) return
      this.pdf.page = p
      await nextTick()
      await this.renderPdfPage()
      const scroll = this.$refs.pdfScroll
      if (scroll) scroll.scrollTop = 0
    },
    /** 文档预览统一缩放：word（zoom 重排，清晰）、excel（zoom）、pdf（canvas 重绘） */
    applyWordZoom() {
      const box = this.$refs.previewBox
      if (!box) return
      const z = (this.wordFit || 1) * (this.preview.zoom || 1)
      box.querySelectorAll('section.docx').forEach(sec => { sec.style.zoom = z.toFixed(4) })
    },
    applyPptZoom() {
      const box = this.$refs.pptBox
      if (!box) return
      const z = (this.pptFit || 1) * (this.preview.zoom || 1)
      box.querySelectorAll('.pptx-preview-slide-wrapper').forEach(s => { s.style.zoom = z.toFixed(4) })
    },
    applyExcelZoom() {
      const el = this.$refs.excelBox
      if (el) el.style.zoom = String(this.preview.zoom || 1)
    },
    previewZoom(d) { this.setPreviewZoom(this.preview.zoom + d) },
    setPreviewZoom(v) {
      this.preview.zoom = Math.max(0.25, Math.min(5, v))
      if (this.preview.kind === 'word') this.applyWordZoom()
      else if (this.preview.kind === 'pdf') this.renderPdfPage()
      else if (this.preview.kind === 'ppt') this.applyPptZoom()
      else this.applyExcelZoom()
    },
    onPreviewDbl() {
      if (this.isOfficePreview || this.preview.kind === 'pdf') this.setPreviewZoom(this.preview.zoom > 1.25 ? 1 : 2)
    },
    onPinchStart(ctx, e) {
      if (e.touches.length !== 2) return
      this.pinch = { ctx, active: true, dist: this._dist(e.touches), base: ctx === 'img' ? this.viewer.scale : this.preview.zoom }
    },
    onPinchMove(e) {
      if (!this.pinch || !this.pinch.active || e.touches.length !== 2) return
      const d = this._dist(e.touches)
      if (d <= 0) return
      const scale = this.pinch.base * (d / this.pinch.dist)
      if (this.pinch.ctx === 'img') this.setImgScale(scale)
      else this.setPreviewZoom(scale)
    },
    onPinchEnd() { if (this.pinch) this.pinch.active = false },
    _dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) },
    closePreview() {
      this.preview.show = false
      if (this.pptViewer) { try { this.pptViewer.destroy() } catch (e) {} }
      this.pptViewer = null
      if (this.pdf.doc) { try { this.pdf.doc.destroy() } catch (e) {} }
      this.pdf = { doc: null, page: 1, numPages: 0, fitScale: 1, rendering: false }
      this.pinch = null
    },
    downloadPreview() {
      if (this.preview.url) window.open(this.preview.url, '_blank')
    },
    /** 图片在线预览：点开全屏大图查看，可缩放/平移/下载；点击遮罩/关闭按钮退出 */
    /** 聊天列表图片：只信消息自带的 thumb_url（历史消息/gif/生成失败为 null），
        加载失败回退原图；不再按路径推导缩略图（老图无 thumb 文件，推导必 404 刷后端日志） */
    imgSrc(m) {
      if (!m || !m.file_url) return ''
      if (m._thumbFail) return fileURL(m.file_url)
      const t = m.thumb_url
      return t ? fileURL(t) : fileURL(m.file_url)
    },
    onImgErr(m) { m._thumbFail = true }, // 缩略图 404/加载失败：回退原图
    openImageView(m) {
      if (!m || !m.file_url) return
      // v5.8.7 双上传：大图默认加载压缩版（file_url，秒开）；originalUrl 为原图，供「下载原图」
      this.viewer = { show: true, url: fileURL(m.file_url), originalUrl: m.file_original_url ? fileURL(m.file_original_url) : '', name: m.file_name || '', scale: 1, tx: 0, ty: 0 }
    },
    closeViewer() { this.viewer.show = false; this.imgGesture = null },
    /** 图片缩放 */
    setImgScale(v) {
      this.viewer.scale = Math.max(0.5, Math.min(5, v))
      if (this.viewer.scale <= 1) { this.viewer.tx = 0; this.viewer.ty = 0 }
    },
    imgZoom(d) { this.setImgScale(this.viewer.scale + d) },
    imgToggleZoom() { this.setImgScale(this.viewer.scale > 1.2 ? 1 : 2.5) },
    /** 图片单指平移 / 双指捏合缩放 */
    imgTouchStart(e) {
      if (e.touches.length === 1) {
        this.imgGesture = { mode: 'pan', sx: e.touches[0].clientX, sy: e.touches[0].clientY, tx0: this.viewer.tx, ty0: this.viewer.ty }
      } else if (e.touches.length === 2) {
        this.imgGesture = { mode: 'pinch', dist: this._dist(e.touches), scale0: this.viewer.scale }
      }
    },
    imgTouchMove(e) {
      if (!this.imgGesture) return
      if (this.imgGesture.mode === 'pan' && e.touches.length === 1 && this.viewer.scale > 1) {
        this.viewer.tx = this.imgGesture.tx0 + (e.touches[0].clientX - this.imgGesture.sx)
        this.viewer.ty = this.imgGesture.ty0 + (e.touches[0].clientY - this.imgGesture.sy)
      } else if (this.imgGesture.mode === 'pinch' && e.touches.length === 2) {
        const d = this._dist(e.touches)
        if (d > 0) this.setImgScale(this.imgGesture.scale0 * d / this.imgGesture.dist)
      }
    },
    imgTouchEnd() { this.imgGesture = null },
    /** 保存原图到本地：App 端走原生 MediaStore 写入系统相册（WebView 的 <a download> 只能落 App 私有目录，
        系统相册永远看不到）；Web 端先取 blob 再触发下载（跨域直链 <a download> 会被浏览器忽略，blob 才可靠） */
    async downloadViewer() {
      if (!this.viewer.url || this.viewer.saving) return
      this.viewer.saving = true
      try {
        // v5.8.7：优先下载原图（originalUrl），无原图（老消息/压缩失败直传）回退当前显示图
        const src = this.viewer.originalUrl || this.viewer.url
        if (Capacitor.isNativePlatform()) {
          // v5.8.8：安卓 App 由原生插件直下原图写入 MediaStore（Pictures/BurnMsg），相册立即可见
          await MediaSaver.saveImage({ url: src, name: this.viewer.name || 'image.jpg' })
          showToast('已保存到系统相册')
        } else {
          const blob = await http.get(src, { responseType: 'blob', timeout: 60000 })
          const objUrl = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = objUrl
          a.download = this.viewer.name || 'image.jpg'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(objUrl), 5000)
          showToast('已保存到本地')
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e || '')
        showToast(msg.indexOf('PERMISSION_REQUIRED') >= 0 ? '请授予存储权限后重试' : '保存失败：' + msg)
      } finally {
        this.viewer.saving = false
      }
    },
    
    /** 视频在线播放：全屏遮罩 + 水平垂直居中撑满播放 + 顶部功能按钮（关闭/名称/下载） */
    openVideo(m) {
      if (!m || !m.file_url) return
      this.videoViewer = { show: true, url: fileURL(m.file_url), name: m.file_name || '视频' }
    },
    closeVideoViewer() { this.videoViewer.show = false },
    /** 下载视频：a 标签 download 触发保存（跨域时退化为新开标签页） */
    downloadVideo() {
      if (!this.videoViewer.url) return
      const a = document.createElement('a')
      a.href = this.videoViewer.url
      a.download = this.videoViewer.name || 'video'
      a.rel = 'noopener'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    },
    /** 是否 @所有人（群聊）：文本含全角/半角 @所有人 */
    isAtAllMsg(m) {
      return !!m && state.chat && state.chat.type !== 'private' && /[＠@]所有人/.test(m.content || '')
    },
    /** 被 @ 的具体成员 uid 列表（后端 mentions 字段；@所有人 不算具体成员） */
    atMentionUids(m) {
      return (m && Array.isArray(m.mentions)) ? m.mentions.filter(uid => uid != null) : []
    },
    /** 是否需要在气泡下展示群 @已读（公开，群里所有人可见）：群聊/频道 + 未撤回 + 有 @（所有人或具体成员） */
    needGroupRead(m) {
      return !!m && !m.is_recalled
        && state.chat && state.chat.type !== 'private'
        && (this.isAtAllMsg(m) || this.atMentionUids(m).length > 0)
    },
    /** 回执列表（缓存，未拉取返回 null） */
    receiptOf(m) {
      const r = this.mentionReceipts[this.e2eKey(m)]
      return Array.isArray(r) ? r : null
    },
    /** 回执成员的头像/名字：优先从群成员列表按 user_id 匹配，兜底回执自带 display name */
    receiptMeta(r) {
      const gm = (state.groupMembers || []).find(x => String(memberUid(x)) === String(r.user_id))
      const name = r.user_display_name || (gm ? memberName(gm) : '') || '成员'
      const avatar = gm ? memberAvatar(gm) : null
      return { name, avatar }
    },
    /** @某人 时的目标显示名（回执未返回时从群成员/文本兜底） */
    atOneName(m) {
      const uids = this.atMentionUids(m)
      if (!uids.length) return '对方'
      const gm = (state.groupMembers || []).find(x => String(memberUid(x)) === String(uids[0]))
      return (gm && memberName(gm)) || '对方'
    },
    /** 群 @消息的已读展示数据：null=不展示；{kind:'atAll',readers,readCount} 或 {kind:'atOne',targetName,read} */
    groupReadInfo(m) {
      if (!this.needGroupRead(m)) return null
      const list = this.receiptOf(m)
      if (!list) return null // 回执尚未拉到：先不渲染，避免「未读」误导性闪烁
      if (this.isAtAllMsg(m)) {
        const readers = list.filter(r => r.is_read && String(r.user_id) !== String(m.sender_id)).map(r => ({ user_id: r.user_id, ...this.receiptMeta(r) }))
        return { kind: 'atAll', readers, readCount: readers.length }
      }
      const uids = this.atMentionUids(m).map(String)
      const target = list.find(r => uids.includes(String(r.user_id)))
      const targetName = target ? (target.user_display_name || this.receiptMeta(target).name) : this.atOneName(m)
      return { kind: 'atOne', targetName, read: !!(target && target.is_read) }
    },
    /** 拉取/刷新群 @消息 的已读回执（公开，含他人发送），缓存到 mentionReceipts（进页/发送/每 5s 轮询调用） */
    async loadMentionReceipts() {
      const c = state.chat
      if (!c || c.type === 'private') { if (Object.keys(this.mentionReceipts).length) this.mentionReceipts = {}; return }
      const targets = state.messages.filter(m => this.needGroupRead(m)).slice(-20)
      if (!targets.length) { if (Object.keys(this.mentionReceipts).length) this.mentionReceipts = {}; return }
      await Promise.allSettled(targets.map(async m => {
        const key = this.e2eKey(m)
        if (state.demoMode) {
          const gm = (state.groupMembers || []).filter(x => String(memberUid(x)) !== String(m.sender_id))
          this.mentionReceipts[key] = gm.slice(0, 3).map((x, i) => ({ user_id: memberUid(x), user_display_name: memberName(x), is_delivered: true, is_read: i < 2, read_at: i < 2 ? new Date().toISOString() : null }))
          return
        }
        try {
          this.mentionReceipts[key] = asArray(await api.getReceipt(m.id))
        } catch (e) { /* 静默：回执拉不到则不展示 */ }
      }))
    },
    onMsgTap(m) {
      this.msgAction = m
    },
    /** 端到端加密消息：点击气泡显示明文 10 秒后自动隐藏；长按/右键仍打开操作菜单 */
    e2eKey(m) {
      return String(m && (m.id ?? m.message_id ?? m.messageId))
    },
    /** 是否端到端加密消息：解密成功(e2e) / 解密失败(e2eFail) / 后端加密标记(is_encrypted)，三者任一即视为加密 */
    isEnc(m) {
      return !!(m && (m.e2e === true || m.e2eFail === true || m.is_encrypted === true))
    },
    /** 是否以裸图渲染（图片消息且未撤回/未焚毁/非模糊占位） */
    isImgMsg(m) {
      return !!(m && m.type === 'image' && m.file_url && !m.is_recalled && !this.isBurned(m) && !this.isBlurredBurn(m))
    },
    /** 是否视频消息：file/video 类型 + 视频扩展名 + 未撤回/未焚毁/非模糊占位（裸媒体直出样式用，不依赖后端 type 细化）——lichangrong b81ab71 原版实现 */
    isVideoMsg(m) {
      if (!m || !m.file_url || m.is_recalled || this.isBurned(m) || this.isBlurredBurn(m)) return false
      if (m.type !== 'file' && m.type !== 'video') return false
      const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
      return ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', '3gp'].includes(ext)
    },
    /** 视频封面：loadedmetadata 后 seek 到 0.1s 显示首帧缩略图（仅一次） */
    seekVideoThumb(e) {
      const v = e && e.target
      if (!v || v.dataset.seeked) return
      v.dataset.seeked = '1'
      try { if (v.readyState >= 1) v.currentTime = 0.1 } catch (err) {}
    },
    onBubbleClick(m) {
      if (this.isBlurredBurn(m)) { revealBurn(m); return } // 焚毁占位卡：点开才焚，reveal 拉完整内容
      if (m.type === 'image' && m.file_url) { this.openImageView(m); return } // 图片：点开全屏预览
      if (this.isVideoMsg(m)) { this.openVideo(m); return } // 视频：全屏遮罩居中播放（可下载）
      if (this.isEnc(m) && !this.isBurnMsg(m)) { this.revealE2E(m); return }
      this.onMsgTap(m)
    },
    revealE2E(m) {
      const key = this.e2eKey(m)
      if (!key) return
      this.reveal[key] = true
      this.revealLeft[key] = 10
      clearInterval(this.revealTickers[key])
      this.revealTickers[key] = setInterval(() => {
        if (this.revealLeft[key] > 1) {
          this.revealLeft[key] -= 1
        } else {
          clearInterval(this.revealTickers[key])
          this.reveal[key] = false
          delete this.revealLeft[key]
        }
      }, 1000)
    },
    copyMsg() {
      const t = (this.msgAction.content || this.msgAction.file_name || '').trim()
      this.msgAction = null
      if (!t) { showToast('无可复制内容'); return }
      copyText(t).then(ok => showToast(ok ? '已复制' : '复制失败'))
    },
    recallMsg() {
      const m = this.msgAction
      this.msgAction = null
      recallMessage(m)
    }
  }
}
</script>
<style scoped>
/* ── 密钥待办（右上角） ── */
.todo-btn { position: relative; }
.todo-dot { position: absolute; top: 4px; right: 4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 9px; background: #E53935; color: #fff; font-size: 10px; font-weight: 600; line-height: 16px; text-align: center; box-sizing: border-box; }
/* ── 附件选择面板 ── */
.attach-grid { display: flex; justify-content: space-around; padding: 6px 20px 14px; }
.attach-item { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 8px 10px; cursor: pointer; border-radius: 12px; }
.attach-item:active { background: var(--tg-gray-bg); }
.attach-ico { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(0,0,0,.12); }
.attach-label { font-size: 13.5px; color: var(--tg-text); }
/* ── 密钥待办面板 ── */
.todo-scroll { overflow-y: auto; }
.todo-empty { text-align: center; color: var(--tg-text-secondary); font-size: 14px; padding: 40px 20px; }
.todo-item { margin: 0 16px 10px; padding: 13px 14px; background: var(--tg-gray-bg); border-radius: 12px; }
.todo-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.todo-item-name { font-size: 15.5px; font-weight: 600; color: var(--tg-text); }
.todo-item-time { font-size: 12px; color: var(--tg-text-secondary); flex-shrink: 0; }
.todo-item-tip { font-size: 13px; color: var(--tg-text-secondary); line-height: 1.5; margin-top: 5px; }
.todo-item-actions { display: flex; gap: 10px; margin-top: 11px; }
.todo-trust { flex: 1; padding: 9px 0; border: none; border-radius: 8px; background: var(--tg-blue); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
.todo-trust:active { opacity: .85; }
.todo-ignore { padding: 9px 16px; border: 1px solid var(--tg-border); border-radius: 8px; background: #fff; color: var(--tg-text-secondary); font-size: 14px; cursor: pointer; }
.todo-ignore:active { background: var(--tg-gray-bg); }
.edit-bar { display: flex; align-items: center; gap: 10px; padding: 7px 14px; background: var(--tg-bg); border-top: 1px solid var(--tg-border); border-left: 3px solid var(--tg-blue); }
.edit-bar-title { font-size: 13px; color: var(--tg-blue); font-weight: 600; }
.edit-bar-text { font-size: 13px; color: var(--tg-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edit-bar-close { cursor: pointer; color: var(--tg-text-secondary); padding: 2px 8px; font-size: 15px; flex-shrink: 0; }
/* ── 引用回复 ── */
.reply-bar { border-left-color: var(--tg-blue); }          /* 绿色左边条区分「编辑」 */
.reply-quote { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; margin-bottom: 0; padding: 5px 8px 6px; border-radius: 6px; cursor: pointer; max-width: 100%; background: rgba(51,144,236,.07); border-left: 2px solid var(--tg-blue); }
.reply-quote:active { opacity: .72; }
.rq-name { font-size: 12.5px; font-weight: 600; color: var(--tg-blue); line-height: 1.3; }
.rq-text { font-size: 12.5px; line-height: 1.35; color: var(--tg-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }


.reply-quote.out { text-align: left; margin-left: 0; }
.reply-quote.in { text-align: left; margin-right: 0; }


.msg-row.highlight .bubble { animation: replyFlash 1.2s ease; }
@keyframes replyFlash { 0%, 60% { box-shadow: 0 0 0 3px rgba(51,144,236,.35); } 100% { box-shadow: 0 1px 2px rgba(0,0,0,.09); } }
.receipt-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; font-size: 15px; }
.receipt-status { color: var(--tg-text-secondary); font-size: 13.5px; }
.receipt-status.read { color: var(--tg-blue); font-weight: 500; }
.read-tag { font-size: 11px; margin-left: 3px; opacity: .85; }
.msg-body.out .read-tag { color: var(--tg-green-check); }          /* 已读：柔和绿 */
.msg-body.out .read-tag.unread { color: var(--tg-text-secondary); } /* 未读：灰白 */
/* ── 群 @消息 已读展示（@所有人=已读头像堆叠 / @某人=对方已读状态） ── */
.group-read { display: flex; align-items: center; gap: 5px; margin-top: 3px; width: fit-content; }
.group-read.out { margin-left: auto; justify-content: flex-end; }
.group-read.in { margin-left: 0; justify-content: flex-start; }
.gr-avatars { display: flex; flex-direction: row-reverse; align-items: center; padding-left: 5px; }
.gr-avatar { width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--tg-chat-bg); margin-left: -5px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 8.5px; font-weight: 600; flex-shrink: 0; }
.gr-avatar:first-child { margin-left: 0; }
.gr-avatar img { width: 100%; height: 100%; object-fit: cover; }
.gr-count { font-size: 11px; color: var(--tg-text-secondary); white-space: nowrap; }
.gr-one { font-size: 11px; color: var(--tg-text-secondary); }
.gr-one.read { color: var(--tg-blue); font-weight: 500; }
.new-msg-pill { position: absolute; right: 14px; bottom: 78px; z-index: 30; display: flex; align-items: center; gap: 4px; background: var(--tg-blue); color: #fff; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 18px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.28); animation: bubbleIn .18s ease; }
.new-msg-pill:active { opacity: .85; }
.dissolved-bar { padding: 14px 16px calc(14px + var(--safe-bottom)); background: var(--tg-bg); border-top: 1px solid var(--tg-border); text-align: center; font-size: 14px; color: var(--tg-text-secondary); }
/* ── 文件在线预览层 ── */
.preview-mask { position: absolute; inset: 0; z-index: 45; background: #f6f7f9; display: flex; flex-direction: column; }
.preview-head { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 12px 8px; background: var(--tg-bg); border-bottom: 1px solid var(--tg-border); flex-shrink: 0; }
.preview-close { color: var(--tg-text); cursor: pointer; display: flex; padding: 5px; border-radius: 8px; }
.preview-close:active { background: var(--tg-gray-bg); }
.preview-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--tg-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview-dl { color: var(--tg-blue); font-size: 14px; font-weight: 500; cursor: pointer; flex-shrink: 0; padding: 6px 8px; }
.preview-body { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
.preview-tip { text-align: center; color: var(--tg-text-secondary); padding: 70px 20px 0; font-size: 14px; }
.preview-tip-btn { display: inline-block; margin-top: 16px; color: #fff; background: var(--tg-blue); border-radius: 8px; padding: 9px 20px; font-size: 14px; cursor: pointer; }
.preview-doc { background: #fff; min-height: 100%; }
/* docx-preview：灰底白纸效果 */
.preview-doc :deep(.docx-wrapper) { display: block !important; background: #f6f7f9 !important; padding: 12px 0 !important; }
.preview-doc :deep(.docx-wrapper > section.docx) { margin-left: auto !important; margin-right: auto !important; box-shadow: 0 1px 4px rgba(0,0,0,.08) !important; margin-bottom: 12px !important; }
/* pptx-preview：深灰放映底 + 白色幻灯片卡片，每页居中留间距 */
.preview-ppt { background: #3a3f45; padding: 18px 0 30px; }
.preview-ppt :deep(.pptx-preview-wrapper) { background: transparent !important; }
.preview-ppt :deep(.pptx-preview-slide-wrapper) { margin: 0 auto 18px !important; box-shadow: 0 2px 14px rgba(0,0,0,.4) !important; }
/* SheetJS 表格（xls 兜底） */
.preview-xlsx { padding: 10px; }
.preview-xlsx :deep(table) { border-collapse: collapse; background: #fff; font-size: 13px; width: max-content; min-width: calc(100% - 20px); }
.preview-xlsx :deep(td), .preview-xlsx :deep(th) { border: 1px solid #dde1e6; padding: 5px 10px; white-space: pre-wrap; word-break: break-word; min-width: 64px; color: #222; }
/* exceljs 自渲染表格（xlsx 带样式还原）：fixed 布局严格按 Excel 列宽，超出截断同 Excel */
.preview-xlsx :deep(.xr-table) { table-layout: fixed; width: max-content; }
.preview-xlsx :deep(.xr-table td) { border: 1px solid #e3e6ea; padding: 3px 8px; overflow: hidden; min-width: 0; background: #fff; }
.preview-xlsx :deep(.xr-empty) { color: #999; padding: 40px; text-align: center; }
.preview-sheet-bar { display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; background: var(--tg-bg); border-bottom: 1px solid var(--tg-border); position: sticky; top: 0; z-index: 2; }
.preview-sheet-tab { flex-shrink: 0; font-size: 13px; padding: 5px 13px; border-radius: 14px; background: var(--tg-gray-bg); color: var(--tg-text-secondary); cursor: pointer; }
.preview-sheet-tab.on { background: var(--tg-blue); color: #fff; }
/* 端到端加密消息：点按查看 */
.e2e-reveal { color: var(--tg-blue); cursor: pointer; }
.bubble.out .e2e-reveal { color: rgba(255,255,255,.92); }
.e2e-reveal:active { opacity: .7; }
.e2e-count { font-size: 10px; line-height: 1; margin-left: 6px; padding: 3px 7px; border-radius: 9px; background: rgba(0,0,0,.10); color: #565c63; font-weight: 600; }
.bubble.out .e2e-count { background: rgba(0,0,0,.20); color: rgba(255,255,255,.92); }

/* ── 图片在线预览层 ── */
.img-viewer { position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,.94); display: flex; flex-direction: column; }
.img-viewer-top { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 12px 8px; color: #fff; flex-shrink: 0; }
.img-viewer-close, .img-viewer-dl { color: #fff; cursor: pointer; display: flex; padding: 5px; border-radius: 8px; }
.img-viewer-close:active, .img-viewer-dl:active { background: rgba(255,255,255,.15); }
.img-viewer-dl-text { font-size: 13px; line-height: 1.4; padding: 6px 10px; align-items: center; border: 1px solid rgba(255,255,255,.35); border-radius: 999px; white-space: nowrap; }
.img-viewer-name { flex: 1; min-width: 0; font-size: 14px; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.img-viewer-body { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
.img-viewer-img { max-width: 100%; max-height: 100%; object-fit: contain; -webkit-user-drag: none; transform-origin: center center; will-change: transform; }
.img-viewer-zoom { display: flex; align-items: center; gap: 4px; margin: 0 2px; }
.iz-btn { color: #fff; font-size: 17px; line-height: 1; cursor: pointer; padding: 6px 9px; border-radius: 8px; user-select: none; }
.iz-btn:active { background: rgba(255,255,255,.15); }
.iz-val { color: rgba(255,255,255,.85); font-size: 12px; min-width: 42px; text-align: center; }
/* ── 视频播放层 ── */
.video-viewer { position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,.94); display: flex; flex-direction: column; }
.video-viewer-top { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 12px 8px; color: #fff; flex-shrink: 0; }
.video-viewer-close, .video-viewer-dl { color: #fff; cursor: pointer; display: flex; padding: 5px; border-radius: 8px; }
.video-viewer-close:active, .video-viewer-dl:active { background: rgba(255,255,255,.15); }
.video-viewer-name { flex: 1; min-width: 0; font-size: 14px; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.video-viewer-body { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.video-viewer-media { width: 100%; max-height: 100%; object-fit: contain; background: #000; }


/* ── 文档预览：缩放按钮 / PDF / 文本 / 音视频 ── */
.preview-zoom { display: flex; align-items: center; gap: 3px; margin-left: auto; flex-shrink: 0; }
.pz-btn { color: var(--tg-text); font-size: 16px; line-height: 1; cursor: pointer; padding: 5px 9px; border-radius: 8px; user-select: none; }
.pz-btn:active { background: var(--tg-gray-bg); }
.pz-val { color: var(--tg-text-secondary); font-size: 12px; min-width: 42px; text-align: center; }
.preview-pdf-bar { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 8px 10px; background: #fff; border-bottom: 1px solid var(--tg-border); position: sticky; top: 0; z-index: 2; flex-shrink: 0; }
.pdf-nav { border: 1px solid var(--tg-border); background: #fff; color: var(--tg-text); border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.pdf-nav:disabled { opacity: .4; cursor: default; }
.pdf-page-label { font-size: 13px; color: var(--tg-text-secondary); min-width: 56px; text-align: center; }
.preview-pdf-scroll { flex: 1; overflow: auto; background: #3a3f45; padding: 10px 0 24px; text-align: center; }
.preview-pdf-scroll canvas { margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,.35); background: #fff; }
.preview-text { margin: 0; padding: 16px; background: #fff; min-height: 100%; white-space: pre-wrap; word-break: break-word; font-family: Consolas, Menlo, Monaco, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #222; }
.preview-media { width: 100%; max-height: 100%; background: #000; }
.preview-audio { padding: 40px 20px; text-align: center; }
.preview-audio audio { width: 100%; }
/* ── @ 提及 ── */
.msg-avatar { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.mention { color: var(--tg-blue); font-weight: 500; }
.mention-me { background: rgba(51, 144, 236, .16); color: var(--tg-blue); font-weight: 600; border-radius: 4px; padding: 0 2px; }
.bubble.out .mention { color: #e3f0ff; }
.bubble.out .mention-me { background: rgba(255, 255, 255, .24); color: #fff; }
.mention-list { overflow-y: auto; padding: 2px 16px 6px; }
.mention-item { display: flex; align-items: center; gap: 12px; padding: 10px 4px; cursor: pointer; border-radius: 10px; }
.mention-item:active { background: var(--tg-gray-bg); }
.mention-avatar { width: 40px; height: 40px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; flex-shrink: 0; }
.mention-name { font-size: 16px; color: var(--tg-text); }
.mention-panel { background: var(--tg-bg); border-top: 1px solid var(--tg-border); box-shadow: 0 -2px 8px rgba(0,0,0,.06); }
.mention-panel .mention-list { max-height: 220px; overflow-y: auto; padding: 4px 12px; }
.mention-panel .mention-item { gap: 10px; padding: 8px 6px; }
.mention-panel .mention-avatar { width: 34px; height: 34px; font-size: 14px; }
.mention-panel .mention-name { font-size: 15px; }
.mention-empty { padding: 14px; text-align: center; color: var(--tg-text-secondary); font-size: 13.5px; }
/* ═══════ 语音消息（V5.8.4）═══════ */
.voice-toggle-btn.active { background: rgba(51, 144, 236, .14); }
.voice-hold { flex: 1; height: 42px; margin: 0; border-radius: 20px; background: var(--tg-gray-bg); color: var(--tg-text); font-size: 15.5px; display: flex; align-items: center; justify-content: center; user-select: none; -webkit-user-select: none; }
.msg-textarea { min-height: 42px; }
.voice-hold.cancel { background: #E53935; color: #fff; }
.msg-voice { display: flex; align-items: center; justify-content: center; gap: 8px; max-width: 240px; min-width: 88px; padding: 9px 12px; cursor: pointer; user-select: none; -webkit-user-select: none; box-sizing: border-box; }
.voice-dur { font-size: 13.5px; font-weight: 600; white-space: nowrap; }
.msg-voice .voice-wave { opacity: .9; flex-shrink: 0; }
.msg-voice.playing .voice-wave rect { animation: voiceWave 1s ease-in-out infinite; }
.msg-voice.playing .voice-wave rect:nth-child(2) { animation-delay: .25s; }
.msg-voice.playing .voice-wave rect:nth-child(3) { animation-delay: .5s; }
@keyframes voiceWave {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(.45); }
}
.voice-rec-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; z-index: 60; }
.voice-rec-box { width: 150px; padding: 22px 16px 18px; border-radius: 18px; background: rgba(0, 0, 0, .78); color: #fff; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.voice-rec-mic { animation: voicePulse 1.4s ease-in-out infinite; }
@keyframes voicePulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.14); opacity: .72; }
}
.voice-rec-box.cancel .voice-rec-mic { animation: none; color: #ff6e6e; }
.voice-rec-time { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.voice-rec-tip { font-size: 12.5px; opacity: .85; }

/* ═══ 会话内消息搜索 ═══ */
.chat-search-panel { flex-shrink: 0; background: var(--tg-bg, #17212b); border-bottom: 1px solid rgba(255,255,255,.06); animation: csSlide .2s ease; }
@keyframes csSlide { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }
.chat-search-bar { display: flex; align-items: center; padding: 8px 12px; gap: 8px; }
.chat-search-input { flex: 1; height: 36px; border: none; border-radius: 18px; padding: 0 14px; font-size: 14px; background: var(--tg-gray-bg, #242f3d); color: var(--tg-text, #fff); outline: none; }
.chat-search-input::placeholder { color: var(--tg-text-secondary, #707579); }
.chat-search-close { cursor: pointer; color: var(--tg-text-secondary, #707579); padding: 4px; display: flex; }
.chat-search-results { max-height: 50vh; overflow-y: auto; padding: 0 8px 8px; }
.chat-search-empty { text-align: center; color: var(--tg-text-secondary, #707579); font-size: 13px; padding: 24px 0; }
.chat-search-more { text-align: center; color: var(--tg-text-secondary, #707579); font-size: 12px; padding: 10px 0; }
.chat-search-item { background: var(--tg-gray-bg, #242f3d); border-radius: 10px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; transition: background .15s; }
.chat-search-item:active { background: rgba(51,144,236,.15); }
.csi-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.csi-name { font-size: 13px; font-weight: 600; color: var(--tg-blue, #5aabdf); }
.csi-time { font-size: 11px; color: var(--tg-text-secondary, #707579); }
.csi-content { font-size: 13px; color: var(--tg-text, #e0e0e0); line-height: 1.45; word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
mark.csi-hl { background: transparent; color: var(--tg-blue, #5aabdf); font-weight: 700; padding: 0; }
.msg-highlight { animation: msgFlash .8s ease; }
@keyframes msgFlash { 0%,100% { background: transparent } 50% { background: rgba(51,144,236,.18) } }
/* 会话内 TOFU 横幅：文档流显示在顶栏下方，不再全局 fixed 覆盖 */
.chat-page .tofu-banners { position: static; z-index: auto; flex-shrink: 0; }
/* ═══════ 待发送文件确认层 ═══════ */
.pending-list { max-height: 46vh; overflow-y: auto; padding: 2px 6px; }
.pending-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 10px; }
.pending-row:active { background: var(--tg-gray-bg, #242f3d); }
.pending-thumb { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: var(--tg-gray-bg, #242f3d); }
.pending-fileth { display: flex; align-items: center; justify-content: center; }
.pending-meta { flex: 1; min-width: 0; }
.pending-name { font-size: 14px; color: var(--tg-text, #e0e0e0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pending-size { font-size: 12px; color: var(--tg-text-secondary, #707579); margin-top: 2px; }
.pending-del { color: var(--tg-text-secondary, #707579); padding: 6px; cursor: pointer; flex-shrink: 0; display: flex; }
.pending-foot { display: flex; align-items: stretch; gap: 8px; margin-top: 12px; padding: 12px 16px 0; border-top: 8px solid var(--tg-gray-bg, #F1F3F5); }
.pending-foot .sheet-item { flex: 1; text-align: center; margin: 0; padding: 13px 0; border-radius: 10px; font-size: 16px; }
.pending-foot .sheet-cancel { margin-top: 0; border-top: none; background: var(--tg-gray-bg, #F1F3F5); color: var(--tg-text, #000); font-weight: 500; }
.pending-send { color: #fff; background: var(--tg-blue); font-weight: 600; }
.pending-send.disabled { opacity: .5; pointer-events: none; }
</style>