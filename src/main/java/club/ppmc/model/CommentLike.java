/**
 * [新文件]
 * 定义了“评论点赞”的数据库实体。
 * - @Table(uniqueConstraints=...): 在数据库层面强制实现 (comment_id, user_id) 的唯一性，确保一人一赞。
 */
package club.ppmc.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "comment_likes", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"comment_id", "user_id"})
})
public class CommentLike {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "comment_id", nullable = false)
    @JsonIgnore
    private LocationComment comment;

    @Column(nullable = false, name = "user_id")
    private String userId;

    @CreationTimestamp
    @Column(nullable = false, updatable = false, name = "created_at")
    private LocalDateTime createdAt;

    // Constructors
    public CommentLike() {}

    public CommentLike(LocationComment comment, String userId) {
        this.comment = comment;
        this.userId = userId;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public LocationComment getComment() { return comment; }
    public void setComment(LocationComment comment) { this.comment = comment; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}