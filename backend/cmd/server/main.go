package main

import (
	"fmt"
	"log"

	"4ever/backend/internal/config"
	"4ever/backend/internal/database"
	"4ever/backend/internal/server"
)

func main() {
	settings := config.Load()
	db, err := database.Open(settings)
	if err != nil {
		log.Fatalf("database open failed: %v", err)
	}
	if err := database.Migrate(db); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	router := server.New(settings, db)
	address := fmt.Sprintf("%s:%d", settings.AppHost, settings.AppPort)
	if err := router.Run(address); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
