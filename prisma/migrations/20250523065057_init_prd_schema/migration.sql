-- CreateTable
CREATE TABLE "eventspotter_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "username" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "eventspotter_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventspotter_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "event_time" TIME,
    "location_description" TEXT NOT NULL,
    "organizer_name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website_url" VARCHAR(2048),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "eventspotter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventspotter_user_saved_events" (
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "saved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventspotter_user_saved_events_pkey" PRIMARY KEY ("user_id","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eventspotter_users_email_key" ON "eventspotter_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "eventspotter_users_username_key" ON "eventspotter_users"("username");

-- AddForeignKey
ALTER TABLE "eventspotter_events" ADD CONSTRAINT "eventspotter_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "eventspotter_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventspotter_user_saved_events" ADD CONSTRAINT "eventspotter_user_saved_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "eventspotter_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventspotter_user_saved_events" ADD CONSTRAINT "eventspotter_user_saved_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "eventspotter_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
