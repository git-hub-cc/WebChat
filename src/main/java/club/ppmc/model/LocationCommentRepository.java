/**
 * [新文件]
 * Spring Data JPA 仓库接口，用于 LocationComment 实体的数据库操作。
 */
package club.ppmc.repository;

import club.ppmc.model.LocationComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LocationCommentRepository extends JpaRepository<LocationComment, Long> {

    /**
     * 根据地点ID查找所有评论，并按创建时间降序排列。
     */
    List<LocationComment> findByLocationIdOrderByCreatedAtDesc(Long locationId);
}