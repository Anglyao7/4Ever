package httputil

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func Error(c *gin.Context, status int, detail string) {
	c.AbortWithStatusJSON(status, gin.H{"detail": detail})
}

func BindJSON(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		Error(c, http.StatusUnprocessableEntity, err.Error())
		return false
	}
	return true
}
