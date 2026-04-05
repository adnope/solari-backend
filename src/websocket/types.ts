import type { MarkConversationAsReadResult } from "../usecases/conversations/mark_conversation_as_read.ts";
import type { ReactMessageResult } from "../usecases/conversations/react_message.ts";
import type { SendMessageResult } from "../usecases/conversations/send_message.ts";
import type { UpdateMessageReactionResult } from "../usecases/conversations/update_message_reaction.ts";
import type { AcceptFriendRequestResult } from "../usecases/friends/accept_friend_request.ts";
import type { FriendRequestResult } from "../usecases/friends/send_friend_request.ts";

export type WsClientTypingEvent = {
  action: "SEND_TYPING_STATE";
  payload: {
    conversationId: string;
    receiverId: string;
    isTyping: boolean;
  };
};

export type WsClientEvent = WsClientTypingEvent;

export type WsNewMessageEvent = {
  type: "NEW_MESSAGE";
  payload: {
    conversationId: string;
    message: SendMessageResult;
  };
};

export type WsMessageUnsentEvent = {
  type: "MESSAGE_UNSENT";
  payload: {
    conversationId: string;
    messageId: string;
    isDeleted: boolean;
  };
};

export type WsNewReactionEvent = {
  type: "NEW_REACTION";
  payload: {
    conversationId: string;
    reaction: ReactMessageResult;
  };
};

export type WsReactionRemovedEvent = {
  type: "REACTION_REMOVED";
  payload: {
    conversationId: string;
    messageId: string;
    userId: string;
  };
};

export type WsReactionUpdatedEvent = {
  type: "REACTION_UPDATED";
  payload: {
    conversationId: string;
    reaction: UpdateMessageReactionResult;
  };
};

export type WsTypingIndicatorEvent = {
  type: "TYPING_INDICATOR";
  payload: {
    conversationId: string;
    senderId: string;
    isTyping: boolean;
  };
};

export type WsConversationReadEvent = {
  type: "CONVERSATION_READ";
  payload: MarkConversationAsReadResult;
};

export type WsNewFriendRequestEvent = {
  type: "NEW_FRIEND_REQUEST";
  payload: FriendRequestResult;
};

export type WsFriendRequestAcceptedEvent = {
  type: "FRIEND_REQUEST_ACCEPTED";
  payload: AcceptFriendRequestResult;
};

export type WsFriendRequestRemovedEvent = {
  type: "FRIEND_REQUEST_REMOVED";
  payload: {
    requestId: string;
    requesterId: string;
    receiverId: string;
  };
};

export type WsFriendshipStatusEvent = {
  type: "FRIENDSHIP_STATUS_CHANGED";
  payload: {
    partnerId: string;
    isFriend: boolean;
  };
};

export type WsFriendProfileUpdatedEvent = {
  type: "FRIEND_PROFILE_UPDATED";
  payload: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarKey: string | null;
  };
};

export type WsPostUploadSuccessfulEvent = {
  type: "POST_PROCESSED";
  payload: {
    postId: string;
    status: string;
  };
};

export type WsPostUploadFailedEvent = {
  type: "POST_FAILED";
  payload: {
    postId: string;
    error: string;
  };
};

export type WsServerEvent =
  | WsNewMessageEvent
  | WsMessageUnsentEvent
  | WsNewReactionEvent
  | WsReactionRemovedEvent
  | WsReactionUpdatedEvent
  | WsTypingIndicatorEvent
  | WsConversationReadEvent
  | WsNewFriendRequestEvent
  | WsFriendRequestAcceptedEvent
  | WsFriendRequestRemovedEvent
  | WsFriendshipStatusEvent
  | WsFriendProfileUpdatedEvent
  | WsPostUploadSuccessfulEvent
  | WsPostUploadFailedEvent;
