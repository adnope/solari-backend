import type { ReactMessageResult } from "../usecases/conversations/react_message.ts";
import type { SendMessageResult } from "../usecases/conversations/send_message.ts";
import type { UpdateMessageReactionResult } from "../usecases/conversations/update_message_reaction.ts";

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

export type WsServerEvent =
  | WsNewMessageEvent
  | WsMessageUnsentEvent
  | WsNewReactionEvent
  | WsReactionRemovedEvent
  | WsTypingIndicatorEvent
  | WsReactionUpdatedEvent;
