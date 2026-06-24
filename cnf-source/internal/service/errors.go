package service

import "fmt"

// recoverErr 将 recover() 的任意值规整为 error。
func recoverErr(r any) error {
	if e, ok := r.(error); ok {
		return e
	}
	return fmt.Errorf("panic: %v", r)
}
