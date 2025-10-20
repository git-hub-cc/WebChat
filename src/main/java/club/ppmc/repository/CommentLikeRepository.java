/**
 * [新文件]
 * Spring Data JPA 仓库接口，用于 CommentLike 实体的数据库操作。
 */
package club.ppmc.repository;

import club.ppmc.model.CommentLike;
import club.ppmc.model.LocationComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface CommentLikeRepository extends JpaRepository<CommentLike, Long> {

    /**
     * 查找特定的点赞记录。
     */
    Optional<CommentLike> findByCommentAndUserId(LocationComment comment, String userId);

    /**
     * 统计指定评论的点赞总数。
     */
    long countByComment(LocationComment comment);

    /**
     * 根据评论ID和用户ID删除点赞记录。
     */
    void deleteByCommentAndUserId(LocationComment comment, String userId);
}