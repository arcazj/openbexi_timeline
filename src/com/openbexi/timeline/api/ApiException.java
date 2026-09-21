package com.openbexi.timeline.api;

/** An expected API failure whose message is safe to send to a client. */
public final class ApiException extends RuntimeException {
    public final int status;
    public ApiException(int status, String detail) { super(detail); this.status = status; }
}
